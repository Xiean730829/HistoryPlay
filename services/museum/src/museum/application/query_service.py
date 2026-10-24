from __future__ import annotations

import base64
import json
from collections.abc import Mapping
from typing import Any

from museum.adapters.content.search_index import PublishedSearchIndex
from museum.application.mappers import (
    ArtifactProjection,
    FactEvidence,
    SearchHit,
    SearchPage,
    SessionContext,
    SourceProjection,
    StoryNodeProjection,
)
from museum.domain.session.models import SessionState
from museum.ports.content_catalog import ContentCatalog, PublishedPack


class ContentUnavailable(LookupError):
    """A pinned published pack or one of its referenced documents is missing."""


class QueryService:
    MAX_QUERY_LENGTH = 120
    MAX_PAGE_SIZE = 50

    def __init__(self, catalog: ContentCatalog) -> None:
        self._catalog = catalog

    def context(self, state: SessionState) -> SessionContext:
        packs = self._load_pinned_packs(state)
        visible_order = (
            list(state.display_order) if state.display_order else list(state.visible_entities)
        )
        visible_order = [
            entity_id for entity_id in visible_order if entity_id in state.visible_entities
        ]
        visible_order.extend(
            entity_id for entity_id in state.visible_entities if entity_id not in visible_order
        )
        visible = tuple(self._artifact(packs, entity_id) for entity_id in visible_order)
        focused = (
            self._artifact(packs, state.focused_entity_id)
            if state.focused_entity_id is not None
            else None
        )
        story_node = None
        if state.story_id is not None and state.node_id is not None:
            node = _find_document(packs, state.node_id, "node")
            if node.get("story_id") != state.story_id:
                raise ContentUnavailable(f"故事节点与当前故事不匹配：{state.node_id}")
            story_node = StoryNodeProjection(
                story_id=state.story_id,
                node_id=state.node_id,
                narration=_optional_text(node.get("narration")),
                fact_grade=_required_text(node.get("fact_grade"), state.node_id),
                presentation=_optional_mapping(node.get("presentation")),
                allowed_actions=tuple(_text_items(node.get("allowed_actions"))),
            )
        return SessionContext(
            session_id=state.session_id,
            revision=state.revision,
            event_seq=state.event_seq,
            mode=state.mode.value,
            focused_artifact=focused,
            visible_artifacts=visible,
            story_node=story_node,
        )

    def search(
        self,
        state: SessionState,
        query: str,
        *,
        kind: str | None = None,
        cursor: str | None = None,
        limit: int = 20,
    ) -> SearchPage:
        query = _normalize(query)
        if not query or len(query) > self.MAX_QUERY_LENGTH:
            raise ValueError("搜索词不能为空且不能超过120个字符")
        if kind not in {None, "artifact", "event", "fact", "story"}:
            raise ValueError("不支持的内容类型")
        if not 1 <= limit <= self.MAX_PAGE_SIZE:
            raise ValueError("分页大小必须在1到50之间")
        packs = self._load_pinned_packs(state)
        pack_fingerprint = tuple((pack.pack_id, pack.version) for pack in packs)
        offset = _decode_cursor(cursor, query, kind, pack_fingerprint) if cursor else 0
        results = sorted(
            (
                SearchHit(
                    id=document.id,
                    kind=document.kind,
                    title=document.title,
                    summary=document.summary[:240],
                    pack_id=document.pack_id,
                    version=document.version,
                )
                for pack in packs
                for document in PublishedSearchIndex(pack).search(query, kind=kind)
            ),
            key=lambda hit: (hit.title, hit.id, hit.pack_id, hit.version),
        )
        page = tuple(results[offset : offset + limit])
        next_offset = offset + len(page)
        next_cursor = (
            _encode_cursor(query, kind, pack_fingerprint, next_offset)
            if next_offset < len(results)
            else None
        )
        return SearchPage(page, next_cursor)

    def read_fact(self, state: SessionState, fact_id: str) -> FactEvidence:
        packs = self._load_pinned_packs(state)
        fact = _find_document(packs, fact_id, "fact")
        source_ids = _text_items(fact.get("source_ids"))
        if not source_ids:
            raise ContentUnavailable(f"事实卡没有可用出处：{fact_id}")
        sources = []
        for source_id in source_ids:
            source = _find_document(packs, source_id, "source")
            locator = source.get("locator")
            if not isinstance(locator, Mapping):
                raise ContentUnavailable(f"来源缺少定位信息：{source_id}")
            sources.append(
                SourceProjection(
                    id=source_id,
                    kind=_required_text(source.get("kind"), source_id),
                    title=_required_text(source.get("title"), source_id),
                    locator=dict(locator),
                    citation_license=_optional_text(source.get("citation_license")),
                )
            )
        applicable_time = fact.get("applicable_time")
        if not isinstance(applicable_time, Mapping):
            raise ContentUnavailable(f"事实卡缺少适用时间：{fact_id}")
        return FactEvidence(
            id=fact_id,
            claim=_required_text(fact.get("claim"), fact_id),
            grade=_required_text(fact.get("grade"), fact_id),
            applicable_time=dict(applicable_time),
            evidence_note=_optional_text(fact.get("evidence_note")),
            dispute=_optional_text(fact.get("dispute")),
            sources=tuple(sources),
        )

    def _load_pinned_packs(self, state: SessionState) -> tuple[PublishedPack, ...]:
        packs = []
        for pack_id, version in state.pack_versions.items():
            try:
                packs.append(self._catalog.get_published(pack_id, version))
            except LookupError as error:
                raise ContentUnavailable(f"会话固定的内容包不可用：{pack_id}@{version}") from error
        return tuple(packs)

    @staticmethod
    def _artifact(packs: tuple[PublishedPack, ...], artifact_id: str) -> ArtifactProjection:
        artifact = _find_document(packs, artifact_id, "artifact")
        museum = artifact.get("museum")
        time_range = artifact.get("time_range")
        if not isinstance(museum, Mapping) or not isinstance(time_range, Mapping):
            raise ContentUnavailable(f"文物缺少馆藏或年代信息：{artifact_id}")
        return ArtifactProjection(
            id=artifact_id,
            title=_required_text(artifact.get("title"), artifact_id),
            museum=dict(museum),
            time_range=dict(time_range),
            material=_required_text(artifact.get("material"), artifact_id),
            category=_required_text(artifact.get("category"), artifact_id),
            asset_ids=tuple(_text_items(artifact.get("asset_ids"))),
            fact_card_ids=tuple(_text_items(artifact.get("fact_card_ids"))),
            story_entry_ids=tuple(_text_items(artifact.get("story_entry_ids"))),
        )


def _find_document(
    packs: tuple[PublishedPack, ...], document_id: str, kind: str
) -> Mapping[str, Any]:
    directory = {
        "artifact": "artifacts/",
        "fact": "facts/",
        "node": "nodes/",
        "source": "sources/",
    }[kind]
    for pack in packs:
        for path, document in pack.documents.items():
            if (
                path.startswith(directory)
                and isinstance(document, Mapping)
                and document.get("id") == document_id
            ):
                return document
    raise ContentUnavailable(f"固定内容版本中找不到{kind}：{document_id}")


def _encode_cursor(
    query: str, kind: str | None, packs: tuple[tuple[str, str], ...], offset: int
) -> str:
    payload = json.dumps(
        {"query": query, "kind": kind, "packs": packs, "offset": offset},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(
    cursor: str, query: str, kind: str | None, packs: tuple[tuple[str, str], ...]
) -> int:
    try:
        if len(cursor) > 512:
            raise ValueError
        encoded = cursor.encode("ascii")
        payload = json.loads(base64.urlsafe_b64decode(encoded + b"=" * (-len(encoded) % 4)))
        if (
            payload["query"] != query
            or payload["kind"] != kind
            or tuple(tuple(item) for item in payload["packs"]) != packs
            or type(payload["offset"]) is not int
            or payload["offset"] < 0
        ):
            raise ValueError
        return payload["offset"]
    except (ValueError, KeyError, TypeError, UnicodeEncodeError, json.JSONDecodeError) as error:
        raise ValueError("分页游标无效或不属于当前查询") from error


def _normalize(value: str) -> str:
    return "".join(value.casefold().split())


def _required_text(value: object, identity: str) -> str:
    if not isinstance(value, str) or not value:
        raise ContentUnavailable(f"内容字段缺失：{identity}")
    return value


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _optional_mapping(value: object) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, Mapping) else None


def _text_items(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item for item in value if isinstance(item, str))
