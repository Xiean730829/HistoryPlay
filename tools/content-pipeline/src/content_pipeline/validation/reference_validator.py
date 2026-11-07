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
    exhibit_type = entity.data.get("exhibit_type")
    if exhibit_type in {"poem", "food", "historical_record"} and entity.data.get("museum") is not None:
        issues.append(entity.locate("诗词、食物或文献展品不能填写虚构馆藏号"))
    if exhibit_type == "painting" and not isinstance(entity.data.get("identity"), dict):
        issues.append(entity.locate("画作必须标明真迹、传本或馆藏局部"))
    if exhibit_type == "object":
        museum = entity.data.get("museum")
        source_ids = _as_ids(entity.data.get("source_ids"))
        if not isinstance(museum, dict) and not source_ids:
            issues.append(entity.locate("器物须有可追溯机构馆藏号或来源"))
        if isinstance(museum, dict) and not museum.get("accession"):
            issues.append(entity.locate("器物馆藏记录缺少馆藏号"))

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
        if exhibit_type == "poem" and display_kind not in _POEM_DISPLAY_KINDS:
            issues.append(entity.locate("诗词不能把排印或演绎图标成真迹照片或三维模型"))
        if display_kind == "interpretive_image":
            label = display.get("interpretation_label")
            if not isinstance(label, str) or not label.strip():
                issues.append(entity.locate("演绎图必须标注艺术演绎，不能冒充真迹照片"))
        if display_kind == "printed_text":
            printed = presentation.get("printed_text")
            if not isinstance(printed, dict) or not isinstance(printed.get("body"), str) or not printed["body"].strip():
                issues.append(entity.locate("排印展示必须提供排印正文，不能用照片冒充手迹"))
        if display_kind == "photo" and exhibit_type == "poem":
            issues.append(entity.locate("诗词不能把排印内容伪装成真迹照片"))
        if isinstance(asset_id, str) and asset_id:
            issues.extend(_check_target(entity, "presentation.display.asset_id", asset_id, "asset", by_id))
            asset = by_id.get(asset_id)
            if asset is not None and asset.kind == "asset":
                expected_kind = _DISPLAY_ASSET_KIND.get(display_kind if isinstance(display_kind, str) else "", "image")
                if display_kind not in _DISPLAY_ASSET_KIND:
                    issues.append(entity.locate(f"不支持的展示类型：{display_kind}"))
                elif asset.data.get("kind") != expected_kind:
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


_DISPLAY_ASSET_KIND = {
    "model3d": "model3d",
    "photo": "image",
    "printed_text": "image",
    "interpretive_image": "image",
}
_POEM_DISPLAY_KINDS = frozenset({"printed_text", "interpretive_image"})


_FIELD_REFS: dict[str, tuple[tuple[str, str | None], ...]] = {
    "artifact": (
        ("asset_ids", "asset"),
        ("fact_card_ids", "fact"),
        ("story_entry_ids", "story"),
        ("source_ids", "source"),
    ),
    "asset": (("derived_from", "asset"), ("fallback_asset_id", "asset")),
    "fact": (("source_ids", "source"),),
    "story": (
        ("entry_node_id", "story-node"),
        ("node_ids", "story-node"),
        ("fact_card_ids", "fact"),
        ("artifact_id", "artifact"),
    ),
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
    issues.extend(_check_gallery_scrolls(entity, station_ids, by_id))
    return issues


def _check_gallery_scrolls(
    entity: Entity,
    station_ids: set[str],
    by_id: dict[str, Entity],
) -> list[Issue]:
    issues: list[Issue] = []
    scrolls = entity.data.get("scrolls")
    if scrolls is None:
        if entity.data.get("presentation_kind") == "song_scroll":
            issues.append(entity.locate("宋风画卷展厅必须声明 scrolls"))
        return issues
    if not isinstance(scrolls, list):
        issues.append(entity.locate("scrolls 必须是数组"))
        return issues
    if entity.data.get("presentation_kind") == "song_scroll" and not scrolls:
        issues.append(entity.locate("宋风画卷展厅必须至少有一卷"))
        return issues
    scroll_ids: set[str] = set()
    station_owner: dict[str, str] = {}
    assigned_stations: set[str] = set()
    for index, scroll in enumerate(scrolls):
        if not isinstance(scroll, dict):
            issues.append(entity.locate(f"scrolls[{index}] 必须是对象"))
            continue
        scroll_id = scroll.get("id")
        if not isinstance(scroll_id, str) or not scroll_id:
            issues.append(entity.locate(f"scrolls[{index}] 缺少稳定卷ID"))
            continue
        if scroll_id in scroll_ids:
            issues.append(entity.locate(f"画卷标识重复：{scroll_id}"))
            continue
        if scroll_id in by_id:
            issues.append(entity.locate(f"画卷标识与已有实体冲突：{scroll_id}"))
            continue
        scroll_ids.add(scroll_id)
        background_id = scroll.get("background_asset_id")
        if isinstance(background_id, str) and background_id:
            issues.extend(
                _check_target(
                    entity,
                    f"scrolls[{index}].background_asset_id",
                    background_id,
                    "asset",
                    by_id,
                )
            )
            background = by_id.get(background_id)
            if (
                background is not None
                and background.kind == "asset"
                and background.data.get("kind") not in {"image", "preview"}
            ):
                issues.append(entity.locate(f"画卷背景必须是图片资产：{background_id}"))
        else:
            issues.append(entity.locate(f"画卷缺少背景资源：{scroll_id}"))
        scroll_stations = _as_ids(scroll.get("station_ids"))
        if not scroll_stations:
            issues.append(entity.locate(f"画卷缺少展位：{scroll_id}"))
        for station_id in scroll_stations:
            if station_id not in station_ids:
                issues.append(entity.locate(f"画卷引用了本展厅没有的展位：{station_id}"))
                continue
            owner = station_owner.get(station_id)
            if owner is not None:
                issues.append(entity.locate(f"展位不能跨卷重复：{station_id} 已属于 {owner}"))
            else:
                station_owner[station_id] = scroll_id
                assigned_stations.add(station_id)
        issues.extend(_check_scroll_hotspots(entity, index, scroll_id, scroll, set(scroll_stations)))
    if entity.data.get("presentation_kind") == "song_scroll":
        missing = sorted(station_ids - assigned_stations)
        for station_id in missing:
            issues.append(entity.locate(f"展位未编入任何画卷：{station_id}"))
    return issues


def _check_scroll_hotspots(
    entity: Entity,
    index: int,
    scroll_id: str,
    scroll: dict[str, object],
    scroll_stations: set[str],
) -> list[Issue]:
    issues: list[Issue] = []
    hotspots = scroll.get("hotspots")
    if hotspots is None:
        return issues
    if not isinstance(hotspots, list):
        issues.append(entity.locate(f"scrolls[{index}].hotspots 必须是数组"))
        return issues
    seen_stations: set[str] = set()
    for spot_index, spot in enumerate(hotspots):
        locate = f"scrolls[{index}].hotspots[{spot_index}]"
        if not isinstance(spot, dict):
            issues.append(entity.locate(f"{locate} 必须是对象"))
            continue
        station_id = spot.get("station_id")
        if not isinstance(station_id, str) or not station_id:
            issues.append(entity.locate(f"{locate} 缺少展位"))
            continue
        if station_id not in scroll_stations:
            issues.append(entity.locate(f"热点不属于本卷展位：{station_id}"))
        if station_id in seen_stations:
            issues.append(entity.locate(f"同一展位在一卷中不能有多个热点：{station_id}"))
        seen_stations.add(station_id)
        values = {key: spot.get(key) for key in ("x", "y", "width", "height")}
        if any(type(value) not in (int, float) or isinstance(value, bool) for value in values.values()):
            issues.append(entity.locate(f"画卷热点坐标无效：{scroll_id}"))
            continue
        x, y, width, height = (float(values[key]) for key in ("x", "y", "width", "height"))
        if not (
            0 <= x <= 1
            and 0 <= y <= 1
            and 0 < width <= 1
            and 0 < height <= 1
            and x + width <= 1
            and y + height <= 1
        ):
            issues.append(entity.locate(f"画卷热点越界：{scroll_id}"))
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
