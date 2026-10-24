from __future__ import annotations

from dataclasses import replace

import pytest
from museum.application.query_service import ContentUnavailable, QueryService
from museum.domain.session.models import SessionMode, SessionState
from museum.ports.content_catalog import PublishedPack

PACK_ID = "cn.tang.core"
VERSION = "1.0.0"
ARTIFACT_ID = "cn.tang.artifact.stele"
FACT_ID = "cn.tang.fact.stele.dated-678"
SOURCE_ID = "cn.tang.source.mia.stele"
STORY_ID = "cn.tang.story.stele-observation"
NODE_ID = "cn.tang.node.stele.01"


def make_artifact(identity: str, title: str, aliases: list[str] | None = None) -> dict:
    return {
        "id": identity,
        "title": title,
        "aliases": aliases or [],
        "museum": {"name": "明尼阿波利斯艺术博物馆", "accession": "art/140016"},
        "time_range": {"start_year": 678, "end_year": 678, "precision": "year"},
        "material": "石",
        "category": "造像碑",
        "asset_ids": ["cn.tang.asset.stele.original"],
        "fact_card_ids": [FACT_ID],
        "story_entry_ids": [STORY_ID],
    }


def make_pack(version: str = VERSION, alias: str = "佛碑") -> PublishedPack:
    artifact_b = "cn.tang.artifact.stele.second"
    documents = {
        "manifest.json": {
            "id": PACK_ID,
            "version": version,
            "publication_status": "published",
        },
        "artifacts/a.json": make_artifact(ARTIFACT_ID, "一佛二菩萨造像碑", [alias]),
        "artifacts/b.json": make_artifact(artifact_b, "浮雕造像残片", ["佛碑残片"]),
        "galleries/main.json": {
            "id": "cn.tang.gallery.main",
            "title": "唐朝长廊",
            "region": {"id": "cn", "label": "中国"},
            "status": "open",
            "default_station_id": "cn.tang.station.first",
            "stations": [
                {
                    "id": "cn.tang.station.first",
                    "order": 0,
                    "time_range": {"start_year": 678, "end_year": 678, "precision": "year"},
                    "placement_basis": "以明确纪年作品作为入口。",
                    "artifact_id": ARTIFACT_ID,
                    "side": "center",
                },
                {
                    "id": "cn.tang.station.second",
                    "order": 1,
                    "time_range": {
                        "start_year": 700,
                        "end_year": 799,
                        "precision": "century",
                    },
                    "placement_basis": "依策展顺序衔接下一展位。",
                    "artifact_id": artifact_b,
                    "side": "right",
                },
            ],
        },
        "facts/dated.json": {
            "id": FACT_ID,
            "claim": "造像碑题记记载其完成于678年。",
            "grade": "fact",
            "applicable_time": {"start_year": 678, "end_year": 678, "precision": "year"},
            "source_ids": [SOURCE_ID],
        },
        "sources/mia.json": {
            "id": SOURCE_ID,
            "kind": "museum_record",
            "title": "馆藏记录：一佛二菩萨造像碑",
            "locator": {"label": "作品页面", "url": "https://example.org/stele"},
        },
        "stories/observation.json": {
            "id": STORY_ID,
            "title": "碑上的纪年",
            "entry_node_id": NODE_ID,
            "node_ids": [NODE_ID],
        },
        "nodes/first.json": {
            "id": NODE_ID,
            "story_id": STORY_ID,
            "fact_grade": "fact",
            "narration": "先观察碑额与题记。",
            "presentation": {"capability": "comic_scene"},
            "allowed_actions": ["observe", "continue_story", "choose_route"],
            "exits": [
                {"action": "continue_story", "target_node_id": "cn.tang.node.stele.02"},
                {
                    "action": "choose_route",
                    "target_node_id": "cn.tang.node.stele.02",
                    "route_label": "查看题记",
                },
            ],
        },
        "nodes/second.json": {
            "id": "cn.tang.node.stele.02",
            "story_id": STORY_ID,
            "fact_grade": "interpretation",
            "narration": "再看题记的位置。",
            "allowed_actions": ["observe"],
            "exits": [{"action": "continue_story", "target_node_id": "cn.tang.node.stele.02"}],
        },
    }
    documents["artifacts/a.json"]["presentation"] = {
        "background_node_id": NODE_ID,
        "teaser": "观察碑额与题记。",
    }
    documents["stories/observation.json"]["node_ids"].append("cn.tang.node.stele.02")
    documents["stories/observation.json"]["artifact_id"] = ARTIFACT_ID
    return PublishedPack(PACK_ID, version, "1", documents)


class MemoryCatalog:
    def __init__(self, *packs: PublishedPack) -> None:
        self.packs = {(pack.pack_id, pack.version): pack for pack in packs}
        self.requests: list[tuple[str, str]] = []

    def list_published(self):
        raise AssertionError("查询必须受会话固定版本约束，不应扫描所有已发布包")

    def get_published(self, pack_id: str, version: str) -> PublishedPack:
        self.requests.append((pack_id, version))
        try:
            return self.packs[(pack_id, version)]
        except KeyError as error:
            raise LookupError("pack missing") from error


def make_state() -> SessionState:
    return SessionState(
        session_id="sess_query_01",
        pack_versions={PACK_ID: VERSION},
        mode=SessionMode.STORY,
        focused_entity_id=ARTIFACT_ID,
        visible_entities=(ARTIFACT_ID, "cn.tang.artifact.stele.second"),
        display_order=("cn.tang.artifact.stele.second", ARTIFACT_ID),
        story_id=STORY_ID,
        node_id=NODE_ID,
        revision=7,
        event_seq=11,
    )


def test_search_uses_explicit_chinese_aliases_pinned_version_and_cursor_scope() -> None:
    old = make_pack("1.0.0", "佛碑")
    new = make_pack("2.0.0", "别名已更新")
    catalog = MemoryCatalog(old, new)
    service = QueryService(catalog)
    state = make_state()

    first = service.search(state, "佛 碑", kind="artifact", limit=1)
    assert len(first.items) == 1
    assert first.items[0].id == ARTIFACT_ID
    assert first.items[0].version == VERSION
    assert first.next_cursor is not None

    second = service.search(state, "佛 碑", kind="artifact", limit=1, cursor=first.next_cursor)
    assert tuple(item.id for item in second.items) == ("cn.tang.artifact.stele.second",)
    with pytest.raises(ValueError, match="游标"):
        service.search(state, "造像碑", kind="artifact", limit=1, cursor=first.next_cursor)
    assert set(catalog.requests) == {(PACK_ID, VERSION)}


def test_context_preserves_server_order_and_projects_the_current_story_node() -> None:
    state = make_state()
    service = QueryService(MemoryCatalog(make_pack()))

    context = service.context(state)

    assert tuple(item.id for item in context.visible_artifacts) == (
        "cn.tang.artifact.stele.second",
        ARTIFACT_ID,
    )
    assert context.focused_artifact is not None
    assert context.focused_artifact.id == ARTIFACT_ID
    assert context.focused_artifact.presentation == {
        "background_node_id": NODE_ID,
        "teaser": "观察碑额与题记。",
    }
    assert context.story_node is not None
    assert context.story_node.node_id == NODE_ID
    assert context.story_node.allowed_actions == ("observe", "continue_story", "choose_route")
    assert tuple(
        (exit.action, exit.target_node_id, exit.route_label)
        for exit in context.story_node.available_exits
    ) == (
        ("continue_story", "cn.tang.node.stele.02", None),
        ("choose_route", "cn.tang.node.stele.02", "查看题记"),
    )
    assert context.revision == state.revision
    assert context.event_seq == state.event_seq


def test_gallery_keeps_curated_station_order_and_projects_read_only_visible_order() -> None:
    state = make_state()
    catalog = MemoryCatalog(make_pack())
    service = QueryService(catalog)

    gallery = service.gallery(state, "cn.tang.gallery.main")

    assert tuple(item.order for item in gallery.stations) == (0, 1)
    assert tuple(item.artifact.id for item in gallery.stations) == (
        ARTIFACT_ID,
        "cn.tang.artifact.stele.second",
    )
    assert tuple(item.id for item in gallery.visible_artifacts) == (
        "cn.tang.artifact.stele.second",
        ARTIFACT_ID,
    )
    assert gallery.stations[0].is_focused
    assert all(item.is_visible for item in gallery.stations)
    assert set(catalog.requests) == {(PACK_ID, VERSION)}
    assert state == make_state()


def test_gallery_query_fails_when_pinned_pack_has_no_requested_gallery() -> None:
    service = QueryService(MemoryCatalog(make_pack()))
    with pytest.raises(ContentUnavailable, match="找不到展厅"):
        service.gallery(make_state(), "cn.tang.gallery.missing")


def test_fact_read_returns_grade_applicable_time_and_real_source_locator() -> None:
    state = make_state()
    service = QueryService(MemoryCatalog(make_pack()))

    evidence = service.read_fact(state, FACT_ID)

    assert evidence.grade == "fact"
    assert evidence.applicable_time["start_year"] == 678
    assert evidence.sources[0].id == SOURCE_ID
    assert evidence.sources[0].locator["label"] == "作品页面"
    assert state == make_state()


def test_story_content_pages_are_stable_bounded_and_include_related_sources() -> None:
    state = make_state()
    service = QueryService(MemoryCatalog(make_pack()))

    first = service.read_content(
        state,
        pack_id=PACK_ID,
        version=VERSION,
        content_id=STORY_ID,
        limit=1,
    )
    second = service.read_content(
        state,
        pack_id=PACK_ID,
        version=VERSION,
        content_id=STORY_ID,
        limit=1,
        cursor=first.next_cursor,
    )

    assert first.paragraphs[0].content_id == NODE_ID
    assert first.paragraphs[0].paragraph_number == 1
    assert first.next_cursor is not None
    assert second.paragraphs[0].content_id == "cn.tang.node.stele.02"
    assert second.paragraphs[0].paragraph_number == 2
    assert second.next_cursor is None
    assert first.related_facts[0].sources[0].id == SOURCE_ID
    assert first.text_bytes <= 4096
    assert state == make_state()


def test_content_pages_respect_utf8_budget_without_omitting_authored_text() -> None:
    pack = make_pack()
    documents = dict(pack.documents)
    first = dict(documents["nodes/first.json"])
    first["narration"] = "碑" * 800
    second = dict(documents["nodes/second.json"])
    second["narration"] = "题" * 800
    documents["nodes/first.json"] = first
    documents["nodes/second.json"] = second
    catalog = MemoryCatalog(replace(pack, documents=documents))
    service = QueryService(catalog)

    first_page = service.read_content(
        make_state(), pack_id=PACK_ID, version=VERSION, content_id=STORY_ID, byte_budget=2560
    )
    second_page = service.read_content(
        make_state(),
        pack_id=PACK_ID,
        version=VERSION,
        content_id=STORY_ID,
        byte_budget=2560,
        cursor=first_page.next_cursor,
    )

    assert len(first_page.paragraphs) == len(second_page.paragraphs) == 1
    assert first_page.text_bytes == second_page.text_bytes == 2400
    assert first_page.paragraphs[0].text + second_page.paragraphs[0].text == "碑" * 800 + "题" * 800


def test_content_reader_rejects_wrong_version_and_cursor_scope() -> None:
    service = QueryService(MemoryCatalog(make_pack()))
    with pytest.raises(ValueError, match="固定"):
        service.read_content(make_state(), pack_id=PACK_ID, version="2.0.0", content_id=STORY_ID)
    with pytest.raises(ValueError, match="游标"):
        service.read_content(
            make_state(),
            pack_id=PACK_ID,
            version=VERSION,
            content_id=STORY_ID,
            cursor="not-a-cursor",
        )
    page = service.read_content(
        make_state(), pack_id=PACK_ID, version=VERSION, content_id=STORY_ID, limit=1
    )
    with pytest.raises(ValueError, match="游标"):
        service.read_content(
            make_state(),
            pack_id=PACK_ID,
            version=VERSION,
            content_id="cn.tang.node.stele.02",
            cursor=page.next_cursor,
        )


def test_artifact_background_resolves_its_single_authored_story_node() -> None:
    page = QueryService(MemoryCatalog(make_pack())).read_content(
        make_state(), pack_id=PACK_ID, version=VERSION, content_id=ARTIFACT_ID
    )

    assert page.content_kind == "background"
    assert page.paragraphs[0].content_id == NODE_ID
    assert page.paragraphs[0].story_id == STORY_ID
    assert page.paragraphs[0].text == "先观察碑额与题记。"
    assert page.next_cursor is None


def test_content_reader_rejects_byte_budgets_that_cannot_fit_a_paragraph() -> None:
    with pytest.raises(ValueError, match="字节预算"):
        QueryService(MemoryCatalog(make_pack())).read_content(
            make_state(),
            pack_id=PACK_ID,
            version=VERSION,
            content_id=STORY_ID,
            byte_budget=128,
        )


def test_query_fails_closed_when_a_pinned_version_or_citation_is_missing() -> None:
    state = make_state()
    service = QueryService(MemoryCatalog(make_pack(alias="造像碑")))
    broken_state = replace(state, pack_versions={PACK_ID: "9.9.9"})
    with pytest.raises(ContentUnavailable, match="固定的内容包"):
        service.search(broken_state, "碑")

    missing_source_pack = make_pack()
    missing_source_pack = replace(
        missing_source_pack,
        documents={
            key: value
            for key, value in missing_source_pack.documents.items()
            if not key.startswith("sources/")
        },
    )
    service = QueryService(MemoryCatalog(missing_source_pack))
    with pytest.raises(ContentUnavailable, match="source"):
        service.read_fact(state, FACT_ID)


@pytest.mark.parametrize("limit", [0, 51])
def test_search_rejects_unbounded_or_empty_pages(limit: int) -> None:
    service = QueryService(MemoryCatalog(make_pack()))
    with pytest.raises(ValueError, match="分页"):
        service.search(make_state(), "碑", limit=limit)
