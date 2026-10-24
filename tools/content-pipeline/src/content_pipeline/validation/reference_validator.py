from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import Path

from yaml import YAMLError

from content_pipeline.validation.schema_validator import Issue, iter_pack_files, load_yaml

KIND_LABEL = {
    "manifest": "内容包",
    "artifact": "文物",
    "asset": "资产",
    "source": "来源",
    "fact": "事实卡",
    "story": "故事",
    "story-node": "故事节点",
    "event": "历史事件",
    "relation": "关系",
    "gallery": "展厅",
    "gallery-station": "展位",
}


@dataclass(frozen=True)
class Entity:
    ident: str
    kind: str
    path: Path
    data: dict[str, object]
    index: int | None = None

    def locate(self, message: str) -> Issue:
        if self.index is None:
            return Issue(self.path, message)
        return Issue(self.path, f"[{self.index}] {message}")


def _iter_entities(pack_dir: Path) -> list[Entity]:
    entities: list[Entity] = []
    for path, kind in iter_pack_files(pack_dir):
        try:
            data = load_yaml(path)
        except YAMLError:
            continue
        rows: list[tuple[int | None, object]]
        if kind == "relation" and isinstance(data, list):
            rows = list(enumerate(data))
        else:
            rows = [(None, data)]
        for index, item in rows:
            if not isinstance(item, dict):
                continue
            ident = item.get("id")
            if isinstance(ident, str) and ident:
                entities.append(Entity(ident, kind, path, item, index))
            if kind == "gallery" and isinstance(item.get("stations"), list):
                for station_index, station in enumerate(item["stations"]):
                    if not isinstance(station, dict):
                        continue
                    station_id = station.get("id")
                    if isinstance(station_id, str) and station_id:
                        entities.append(
                            Entity(station_id, "gallery-station", path, station, station_index)
                        )
    return entities


def _as_ids(value: object) -> list[str]:
    if isinstance(value, str) and value:
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item]
    return []


def _pack_namespace(entities: list[Entity]) -> str | None:
    for entity in entities:
        if entity.kind == "manifest":
            parts = entity.ident.split(".")
            if len(parts) >= 3:
                return ".".join(parts[:-1])
    return None


def _check_target(
    entity: Entity,
    field: str,
    target_id: str,
    expected_kind: str | None,
    by_id: dict[str, Entity],
) -> list[Issue]:
    issues: list[Issue] = []
    if expected_kind == "asset" and target_id == entity.ident:
        issues.append(entity.locate(f"{field} 不能引用自身：{target_id}"))
        return issues
    found = by_id.get(target_id)
    if found is None:
        issues.append(entity.locate(f"{field} 缺少引用：{target_id}"))
        return issues
    if expected_kind is not None and found.kind != expected_kind:
        expected = KIND_LABEL.get(expected_kind, expected_kind)
        actual = KIND_LABEL.get(found.kind, found.kind)
        issues.append(entity.locate(f"{field} 需要{expected}，实际是{actual}：{target_id}"))
    return issues


def _check_field(
    entity: Entity,
    field: str,
    expected_kind: str | None,
    by_id: dict[str, Entity],
) -> list[Issue]:
    issues: list[Issue] = []
    for target_id in _as_ids(entity.data.get(field)):
        issues.extend(_check_target(entity, field, target_id, expected_kind, by_id))
    return issues


def _check_story(entity: Entity, by_id: dict[str, Entity]) -> list[Issue]:
    issues: list[Issue] = []
    node_ids = _as_ids(entity.data.get("node_ids"))
    entry = entity.data.get("entry_node_id")
    if isinstance(entry, str) and entry and entry not in node_ids:
        issues.append(entity.locate(f"故事入口节点未列入 node_ids：{entry}"))
    for node_id in node_ids:
        node = by_id.get(node_id)
        if node is None or node.kind != "story-node":
            continue
        owner = node.data.get("story_id")
        if owner != entity.ident:
            issues.append(entity.locate(f"node_ids 中的节点不属于本故事：{node_id}"))
    return issues


def _check_story_node(entity: Entity, by_id: dict[str, Entity]) -> list[Issue]:
    issues: list[Issue] = []
    presentation = entity.data.get("presentation")
    if isinstance(presentation, dict):
        for target_id in _as_ids(presentation.get("asset_ids")):
            issues.extend(
                _check_target(entity, "presentation.asset_ids", target_id, "asset", by_id)
            )
        audio_id = presentation.get("audio_asset_id")
        if isinstance(audio_id, str) and audio_id:
            issues.extend(_check_target(entity, "presentation.audio_asset_id", audio_id, "asset", by_id))
            audio = by_id.get(audio_id)
            if audio is not None and audio.kind == "asset" and audio.data.get("kind") != "audio":
                issues.append(entity.locate(f"presentation.audio_asset_id 需要音频资产：{audio_id}"))
    exits = entity.data.get("exits")
    if isinstance(exits, list):
        for index, item in enumerate(exits):
            if not isinstance(item, dict):
                continue
            target_id = item.get("target_node_id")
            if isinstance(target_id, str) and target_id:
                issues.extend(
                    _check_target(
                        entity, f"exits[{index}].target_node_id", target_id, "story-node", by_id
                    )
                )
    story_id = entity.data.get("story_id")
    if isinstance(story_id, str) and story_id:
        story = by_id.get(story_id)
        if story is not None and story.kind == "story":
            node_ids = _as_ids(story.data.get("node_ids"))
            if entity.ident not in node_ids:
                issues.append(entity.locate(f"节点未列入所属故事的 node_ids：{story_id}"))
    return issues


def _check_artifact(entity: Entity, by_id: dict[str, Entity]) -> list[Issue]:
    issues: list[Issue] = []
    presentation = entity.data.get("presentation")
    if not isinstance(presentation, dict):
        return issues

    preview_id = presentation.get("preview_asset_id")
    if isinstance(preview_id, str) and preview_id:
        issues.extend(_check_target(entity, "presentation.preview_asset_id", preview_id, "asset", by_id))
        preview = by_id.get(preview_id)
        if preview is not None and preview.kind == "asset" and preview.data.get("kind") not in {"preview", "image"}:
            issues.append(entity.locate(f"presentation.preview_asset_id 需要预览图或图片资产：{preview_id}"))

    display = presentation.get("display")
    if isinstance(display, dict):
        asset_id = display.get("asset_id")
        display_kind = display.get("kind")
        if isinstance(asset_id, str) and asset_id:
            issues.extend(_check_target(entity, "presentation.display.asset_id", asset_id, "asset", by_id))
            asset = by_id.get(asset_id)
            if asset is not None and asset.kind == "asset":
                expected_kind = "model3d" if display_kind == "model3d" else "image"
                if asset.data.get("kind") != expected_kind:
                    issues.append(
                        entity.locate(
                            f"presentation.display.kind 与资产类型不一致：{display_kind} / {asset.data.get('kind')}"
                        )
                    )
                if display_kind == "model3d" and asset.data.get("lod") not in {"display", "mobile"}:
                    issues.append(
                        entity.locate(
                            f"presentation.display.asset_id 需要展示版或移动版模型：{asset_id}"
                        )
                    )

    node_id = presentation.get("background_node_id")
    if isinstance(node_id, str) and node_id:
        issues.extend(_check_target(entity, "presentation.background_node_id", node_id, "story-node", by_id))
        node = by_id.get(node_id)
        if node is not None and node.kind == "story-node":
            story_id = node.data.get("story_id")
            story = by_id.get(story_id) if isinstance(story_id, str) else None
            if not isinstance(story, Entity) or story.kind != "story" or story.data.get("artifact_id") != entity.ident:
                issues.append(entity.locate(f"presentation.background_node_id 必须属于该文物的故事：{node_id}"))
            if not isinstance(node.data.get("narration"), str) or not node.data["narration"].strip():
                issues.append(entity.locate(f"presentation.background_node_id 指向没有讲稿正文的节点：{node_id}"))
    return issues


_FIELD_REFS: dict[str, tuple[tuple[str, str | None], ...]] = {
    "artifact": (("asset_ids", "asset"), ("fact_card_ids", "fact"), ("story_entry_ids", "story")),
    "asset": (("derived_from", "asset"), ("fallback_asset_id", "asset")),
    "fact": (("source_ids", "source"),),
    "story": (("entry_node_id", "story-node"), ("node_ids", "story-node"), ("artifact_id", "artifact")),
    "story-node": (("story_id", "story"),),
    "event": (
        ("fact_card_ids", "fact"),
        ("related_artifact_ids", "artifact"),
        ("tell_story_id", "story"),
        ("role_story_id", "story"),
    ),
    "relation": (("from_id", None), ("to_id", None), ("fact_card_id", "fact")),
}


def validate_references(pack_dir: Path, dependency_packs: list[Path] | None = None) -> list[Issue]:
    local_entities = _iter_entities(pack_dir)
    if not local_entities:
        return []
    dependency_entities = [
        entity
        for dependency in dependency_packs or []
        for entity in _iter_entities(dependency)
    ]
    entities = [*local_entities, *dependency_entities]
    issues: list[Issue] = []
    by_id: dict[str, Entity] = {}
    for entity in entities:
        existing = by_id.get(entity.ident)
        if existing is not None:
            issues.append(
                entity.locate(f"重复的标识：{entity.ident}（已在 {existing.path} 定义）")
            )
            continue
        by_id[entity.ident] = entity

    namespace = _pack_namespace(local_entities)
    if namespace:
        prefix = namespace + "."
        for entity in local_entities:
            if entity.kind == "manifest":
                continue
            if not entity.ident.startswith(prefix):
                issues.append(entity.locate(f"标识不属于内容包命名空间 {namespace}：{entity.ident}"))

    issues.extend(_check_artifact_aliases(local_entities))

    for entity in local_entities:
        for field, expected_kind in _FIELD_REFS.get(entity.kind, ()):
            issues.extend(_check_field(entity, field, expected_kind, by_id))
        if entity.kind == "story":
            issues.extend(_check_story(entity, by_id))
        elif entity.kind == "artifact":
            issues.extend(_check_artifact(entity, by_id))
        elif entity.kind == "story-node":
            issues.extend(_check_story_node(entity, by_id))
        elif entity.kind == "gallery":
            issues.extend(_check_gallery(entity, by_id))
    return issues


def _check_gallery(entity: Entity, by_id: dict[str, Entity]) -> list[Issue]:
    issues: list[Issue] = []
    stations = entity.data.get("stations")
    if not isinstance(stations, list):
        return issues
    station_ids: set[str] = set()
    orders: set[int] = set()
    primary_station_by_artifact: dict[str, int] = {}
    for index, station in enumerate(stations):
        if not isinstance(station, dict):
            continue
        station_id = station.get("id")
        if isinstance(station_id, str):
            if station_id in station_ids:
                issues.append(entity.locate(f"展位标识重复：{station_id}"))
            station_ids.add(station_id)
        order = station.get("order")
        if isinstance(order, int) and not isinstance(order, bool):
            if order in orders:
                issues.append(entity.locate(f"展位顺序重复：{order}"))
            orders.add(order)
        for field in ("artifact_id", "comparison_artifact_ids"):
            for target_id in _as_ids(station.get(field)):
                issues.extend(
                    _check_target(
                        entity,
                        f"stations[{index}].{field}",
                        target_id,
                        "artifact",
                        by_id,
                    )
                )
        artifact_id = station.get("artifact_id")
        if isinstance(artifact_id, str):
            prior_order = primary_station_by_artifact.get(artifact_id)
            if prior_order is not None:
                issues.append(
                    entity.locate(
                        f"主展品只能有一个展位：{artifact_id} 已在顺序 {prior_order} 陈列"
                    )
                )
            else:
                primary_station_by_artifact[artifact_id] = order if isinstance(order, int) else index
    default_station_id = entity.data.get("default_station_id")
    if isinstance(default_station_id, str) and default_station_id not in station_ids:
        issues.append(entity.locate(f"默认展位不属于本展厅：{default_station_id}"))
    return issues


def _check_artifact_aliases(entities: list[Entity]) -> list[Issue]:
    issues: list[Issue] = []
    alias_owner: dict[str, tuple[str, str]] = {}
    for entity in entities:
        if entity.kind != "artifact":
            continue
        names = [entity.data.get("title"), *_as_ids(entity.data.get("aliases"))]
        for name in names:
            if not isinstance(name, str) or not name.strip():
                continue
            normalized = " ".join(unicodedata.normalize("NFKC", name).split()).casefold()
            previous = alias_owner.get(normalized)
            if previous is not None and previous[0] != entity.ident:
                issues.append(
                    entity.locate(
                        f"文物名称或别名冲突：{name} 与 {previous[1]} 都指向不同文物"
                    )
                )
            else:
                alias_owner[normalized] = (entity.ident, name)
    return issues
