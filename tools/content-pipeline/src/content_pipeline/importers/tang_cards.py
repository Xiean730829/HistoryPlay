from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import yaml


class TangCardImportError(ValueError):
    """The author bundle cannot be safely imported as a review candidate."""


SOURCE_KIND = {
    "museum_catalog": "museum_record",
    "open_text": "open_text",
    "book": "book",
    "article": "article",
    "excavation": "excavation",
}


def import_tang_card_candidates(
    *, source_root: Path, candidate_root: Path, id_map_path: Path
) -> dict[str, Any]:
    """Build schema-shaped, unpublished packages without editing source packs."""
    root = _existing_directory(source_root, "作者内容目录")
    output = candidate_root.resolve()
    if output == root or root in output.parents or output in root.parents:
        raise TangCardImportError("候选输出目录不得与作者源目录重叠")
    if not id_map_path.is_file():
        raise TangCardImportError("缺少稳定ID映射表")

    id_map = _load_yaml(id_map_path)
    cards = _load_cards(root / "cards")
    timeline = _read_json(root / "timeline.json")
    facts_doc = _read_json(root / "fact-cards.json")
    sources_doc = _read_json(root / "sources.json")
    history_doc = _read_json(root / "history-sources.json")
    people_doc = _read_json(root / "people.json")
    historical_people_doc = _read_json(root / "historical-people.json")
    bindings_doc = _read_json(root / "scene-bindings.json")

    card_map = id_map.get("cards")
    if not isinstance(card_map, dict):
        raise TangCardImportError("ID映射表必须包含cards对象")
    if set(card_map) != {card["code"] for card in cards}:
        raise TangCardImportError("ID映射表必须与作者卡片代码一一对应")
    _validate_author_indexes(
        cards,
        timeline,
        facts_doc,
        sources_doc,
        history_doc,
        people_doc,
        historical_people_doc,
        bindings_doc,
    )

    artifact_sources = _records(sources_doc, "sources", "sources.json")
    history_sources = _records(history_doc, "sources", "history-sources.json")
    sources = artifact_sources + history_sources
    source_by_id = _unique_by_id(sources, "来源")
    for card in cards:
        for source_id in _string_list(card.get("source_ids"), f"{card['code']}.source_ids"):
            if source_id not in source_by_id:
                raise TangCardImportError(f"作者卡引用缺失来源：{card['code']} → {source_id}")
    facts = _records(facts_doc, "fact_cards", "fact-cards.json")
    card_by_catalog_source: dict[str, dict[str, Any]] = {}
    for card in cards:
        for source_id in card.get("source_ids", []):
            if isinstance(source_id, str):
                card_by_catalog_source[source_id] = card

    grouped: dict[str, list[dict[str, Any]]] = {}
    deferred_cards: list[dict[str, Any]] = []
    for card in cards:
        mapping = card_map[card["code"]]
        if not isinstance(mapping, dict):
            raise TangCardImportError(f"ID映射无效：{card['code']}")
        _validate_card_mapping(card, mapping)
        exclusion_reason = _candidate_exclusion_reason(card)
        if exclusion_reason is not None:
            deferred_cards.append(
                {
                    "code": card["code"],
                    "artifact_id": card["id"],
                    "date_label": card.get("date_label"),
                    "review_status": card.get("review_status"),
                    "reason": exclusion_reason,
                }
            )
            continue
        package_id = mapping["package_id"]
        grouped.setdefault(package_id, []).append(card)
    if not grouped:
        raise TangCardImportError("作者卡没有可安全转换为Schema的候选文物")

    fact_by_artifact: dict[str, list[dict[str, Any]]] = {}
    fact_docs_by_package: dict[str, list[dict[str, Any]]] = {}
    for fact in facts:
        fact_id = _required_id(fact, "作者事实卡")
        fact_source_ids = _string_list(fact.get("source_ids"), f"{fact_id}.source_ids")
        owners = {
            card_by_catalog_source[item]["id"]
            for item in fact_source_ids
            if item in card_by_catalog_source
        }
        if len(owners) != 1:
            continue
        artifact_id = next(iter(owners))
        if artifact_id in {item["artifact_id"] for item in deferred_cards}:
            continue
        card = next(card for card in cards if card["id"] == artifact_id)
        package_id = card_map[card["code"]]["package_id"]
        imported = {
            "id": fact_id,
            "claim": _required_text(fact.get("claim"), f"{fact_id}.claim"),
            "grade": _fact_grade(fact.get("grade"), fact_id),
            "applicable_time": _schema_time_range(card),
            "source_ids": fact_source_ids,
        }
        if isinstance(fact.get("evidence_note"), str) and fact["evidence_note"]:
            imported["evidence_note"] = fact["evidence_note"][:400]
        fact_by_artifact.setdefault(artifact_id, []).append(imported)
        fact_docs_by_package.setdefault(package_id, []).append(imported)

    source_docs_by_package: dict[str, list[dict[str, Any]]] = {}
    source_to_package = {
        source_id: card_map[card["code"]]["package_id"]
        for card in cards
        for source_id in card.get("source_ids", [])
        if isinstance(source_id, str)
    }
    for source in sources:
        source_id = _required_id(source, "作者来源")
        package_id = source_to_package.get(source_id)
        if package_id is None:
            package_id = _namespace_package(source_id, grouped)
        if package_id is None:
            continue
        imported = _convert_source(source, source_id)
        source_docs_by_package.setdefault(package_id, []).append(imported)

    documents: dict[str, Any] = {}
    for package_id, package_cards in grouped.items():
        prefix = _package_directory(package_id)
        times = [card["time_range"] for card in package_cards]
        manifest = _manifest(package_id, package_cards, times)
        documents[f"{prefix}/manifest.yaml"] = manifest
        for card in package_cards:
            mapping = card_map[card["code"]]
            artifact_id = mapping["artifact_id"]
            story = card.get("story")
            if not isinstance(story, dict):
                raise TangCardImportError(f"作者卡缺少故事候选：{card['code']}")
            fact_rows = fact_by_artifact.get(artifact_id, [])
            artifact = {
                "id": artifact_id,
                "title": _required_text(card.get("title"), f"{card['code']}.title"),
                "museum": {
                    "name": _required_text(card.get("museum"), f"{card['code']}.museum"),
                    "accession": _required_text(card.get("accession"), f"{card['code']}.accession"),
                },
                "time_range": _schema_time_range(card),
                "material": _required_text(card.get("material"), f"{card['code']}.material"),
                "category": mapping["category"],
                "asset_ids": [],
                "fact_card_ids": [item["id"] for item in fact_rows],
                "story_entry_ids": [_required_id(story, f"{card['code']}.story")],
            }
            primary_source = card.get("primary_source")
            if isinstance(primary_source, str) and primary_source:
                artifact["museum"]["collection_url"] = primary_source
            if card.get("identity_unknown") is True:
                artifact["identity_unknown"] = True
            documents[f"{prefix}/artifacts/{_safe_stem(card['code'])}.yaml"] = artifact
            story_doc, node_docs = _convert_story(card, artifact_id)
            story_stem = _safe_stem(card["code"])
            documents[f"{prefix}/stories/{story_stem}.yaml"] = story_doc
            for index, node in enumerate(node_docs, start=1):
                documents[f"{prefix}/nodes/{story_stem}-{index:02d}.yaml"] = node

        for source in source_docs_by_package.get(package_id, []):
            documents[f"{prefix}/sources/{_id_stem(source['id'])}.yaml"] = source
        for fact in fact_docs_by_package.get(package_id, []):
            documents[f"{prefix}/facts/{_id_stem(fact['id'])}.yaml"] = fact

    authoring_index = _authoring_index(
        timeline, people_doc, historical_people_doc, bindings_doc, cards, deferred_cards
    )
    documents["authoring-index.json"] = authoring_index
    return _write_candidate_documents(output, documents, source_root=root)


def _manifest(
    package_id: str, cards: list[dict[str, Any]], times: list[dict[str, Any]]
) -> dict[str, Any]:
    start = min(item["start_year"] for item in times)
    end = max(item["end_year"] for item in times)
    if package_id.startswith("iq."):
        region = {"id": "iq.abbasid", "label": "阿拔斯王朝比较器"}
        title = "阿拔斯比较器作者稿候选"
    else:
        region = {"id": "cn", "label": "中国"}
        title = "唐朝逐件作者稿候选"
    return {
        "id": package_id,
        "version": "0.1.0",
        "schema_version": "1",
        "language": "zh-CN",
        "region": region,
        "time_range": {
            "start_year": start,
            "end_year": end,
            "precision": "range",
            "display_label": f"{start}—{end}",
        },
        "required_capabilities": [],
        "publication_status": "draft",
        "title": title,
    }


def _convert_story(
    card: dict[str, Any], artifact_id: str
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source_story = card["story"]
    story_id = _required_id(source_story, f"{card['code']}.story")
    return_target = source_story.get("return_target")
    if not isinstance(return_target, dict) or return_target.get("artifact_id") != artifact_id:
        raise TangCardImportError(f"故事返回目标与文物ID不一致：{card['code']}")
    segments = source_story.get("segments")
    if not isinstance(segments, list) or not segments:
        raise TangCardImportError(f"故事必须包含片段：{card['code']}")
    segment_ids = [_required_id(segment, f"{card['code']}.story.segments") for segment in segments]
    if len(segment_ids) != len(set(segment_ids)):
        raise TangCardImportError(f"故事片段ID重复：{card['code']}")
    node_docs: list[dict[str, Any]] = []
    for index, segment in enumerate(segments):
        segment_id = segment_ids[index]
        next_id = segment.get("next_segment_id")
        if index + 1 < len(segments) and next_id != segment_ids[index + 1]:
            raise TangCardImportError(f"故事片段顺序/下一节点不一致：{segment_id}")
        if index + 1 == len(segments) and next_id is not None:
            raise TangCardImportError(f"最终故事片段仍指向后续节点：{segment_id}")
        is_last = index + 1 == len(segments)
        node = {
            "id": segment_id,
            "story_id": story_id,
            "fact_grade": _fact_grade(segment.get("grade"), segment_id),
            "narration": _required_text(
                segment.get("narration_text"), f"{segment_id}.narration_text"
            ),
            "allowed_actions": [
                "ask",
                "observe",
                "return_to_exhibit" if is_last else "continue_story",
            ],
            "exits": [
                {
                    "action": "return_to_exhibit" if is_last else "continue_story",
                    "target_node_id": segment_ids[0] if is_last else segment_ids[index + 1],
                }
            ],
        }
        if is_last:
            node["return_checkpoint"] = True
        node_docs.append(node)
    return (
        {
            "id": story_id,
            "title": _required_text(source_story.get("title"), f"{story_id}.title"),
            "entry_node_id": segment_ids[0],
            "node_ids": segment_ids,
            "artifact_id": artifact_id,
            "return_to_exhibit": True,
        },
        node_docs,
    )


def _convert_source(source: dict[str, Any], source_id: str) -> dict[str, Any]:
    kind = SOURCE_KIND.get(source.get("type"))
    if kind is None and "links" in source:
        links = source.get("links")
        first_link = links[0] if isinstance(links, list) and links else {}
        url = first_link.get("url") if isinstance(first_link, dict) else None
        kind = "open_text" if isinstance(url, str) and "wikisource.org" in url else "article"
        title = first_link.get("title") if isinstance(first_link, dict) else None
        label = title or source.get("legacy_id") or source_id
        return {
            "id": source_id,
            "kind": kind,
            "title": _required_text(label, f"{source_id}.title"),
            "locator": {
                "label": _required_text(label, f"{source_id}.locator"),
                **({"url": url} if isinstance(url, str) else {}),
            },
        }
    if kind is None:
        raise TangCardImportError(f"不支持的来源类型：{source_id}: {source.get('type')}")
    title = _required_text(source.get("title"), f"{source_id}.title")
    url = source.get("url")
    locator: dict[str, str] = {"label": title}
    if isinstance(url, str) and url:
        locator["url"] = url
    accessed = source.get("checked_on")
    if isinstance(accessed, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", accessed):
        locator["accessed_on"] = accessed
    return {"id": source_id, "kind": kind, "title": title, "locator": locator}


def _authoring_index(
    timeline: dict[str, Any],
    people: dict[str, Any],
    historical_people: dict[str, Any],
    bindings: dict[str, Any],
    cards: list[dict[str, Any]],
    deferred_cards: list[dict[str, Any]],
) -> dict[str, Any]:
    chapters = timeline.get("chapters")
    if not isinstance(chapters, list):
        raise TangCardImportError("timeline.chapters格式无效")
    characters = people.get("characters")
    historic = historical_people.get("people")
    if not isinstance(characters, list) or not isinstance(historic, list):
        raise TangCardImportError("人物索引格式无效")
    return {
        "schema_version": 1,
        "status": "candidate_not_published",
        "timeline_id": timeline.get("id"),
        "timeline_chapters": [
            {
                "id": item.get("id"),
                "legacy_id": item.get("legacy_id"),
                "title": item.get("title"),
                "date_label": item.get("date_label"),
                "story_year_range": item.get("story_year_range"),
                "character_id": item.get("character_id"),
                "artifact_ids": item.get("artifact_ids", []),
                "historical_source_ids": (
                    item.get("historical_context", {}).get("source_ids", [])
                    if isinstance(item.get("historical_context"), dict)
                    else []
                ),
                "nodes": [
                    {
                        "id": node.get("id"),
                        "legacy_id": node.get("legacy_id"),
                        "scene_asset_id": node.get("scene_asset_id"),
                    }
                    for node in item.get("nodes", [])
                    if isinstance(node, dict)
                ],
            }
            for item in chapters
            if isinstance(item, dict)
        ],
        "author_character_ids": [item.get("id") for item in characters if isinstance(item, dict)],
        "historical_person_ids": [item.get("id") for item in historic if isinstance(item, dict)],
        "scene_asset_ids": sorted(
            {
                segment.get("scene_asset_id")
                for card in cards
                for segment in card.get("story", {}).get("segments", [])
                if isinstance(segment, dict) and isinstance(segment.get("scene_asset_id"), str)
            }
        ),
        "story_scene_bindings": {
            card["code"]: bindings.get("artifact_story_assets", {}).get(card["code"])
            for card in cards
        },
        "chapter_scene_asset_ids": sorted(
            {
                node.get("scene_asset_id")
                for chapter in chapters
                if isinstance(chapter, dict)
                for node in chapter.get("nodes", [])
                if isinstance(node, dict) and isinstance(node.get("scene_asset_id"), str)
            }
        ),
        "deferred_cards": deferred_cards,
        "pending": [
            "章节正文节点、人物档案和未审核媒体不编入运行包，由后续独立任务导入。",
            "该候选包没有模型/图像资产绑定，不能直接用于运行时发布。",
        ],
    }


def _validate_author_indexes(
    cards: list[dict[str, Any]],
    timeline: dict[str, Any],
    facts: dict[str, Any],
    sources: dict[str, Any],
    history: dict[str, Any],
    people: dict[str, Any],
    historical_people: dict[str, Any],
    bindings: dict[str, Any],
) -> None:
    chapters = timeline.get("chapters")
    if not isinstance(chapters, list) or len(chapters) != 10:
        raise TangCardImportError("作者timeline必须包含10章")
    if sum(len(item.get("nodes", [])) for item in chapters if isinstance(item, dict)) != 40:
        raise TangCardImportError("作者timeline必须包含40个节点")
    if len(cards) != 20:
        raise TangCardImportError("作者卡片必须恰有20份")
    for document, key, label in (
        (facts, "fact_cards", "事实卡"),
        (sources, "sources", "来源"),
        (history, "sources", "历史来源"),
        (people, "characters", "人物"),
        (historical_people, "people", "历史人物"),
    ):
        if not isinstance(document.get(key), list):
            raise TangCardImportError(f"{label}列表格式无效")
    if not isinstance(bindings.get("artifact_story_assets"), dict):
        raise TangCardImportError("scene-bindings缺少故事素材映射")


def _load_cards(directory: Path) -> list[dict[str, Any]]:
    if not directory.is_dir():
        raise TangCardImportError("作者卡片目录不存在")
    cards: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        value = _read_json(path)
        if not isinstance(value.get("code"), str):
            raise TangCardImportError(f"作者卡片缺少code：{path.name}")
        cards.append(value)
    codes = [card["code"] for card in cards]
    if len(codes) != len(set(codes)):
        raise TangCardImportError("作者卡片code重复")
    return cards


def _validate_card_mapping(card: dict[str, Any], mapping: dict[str, Any]) -> None:
    if mapping.get("artifact_id") != card.get("id"):
        raise TangCardImportError(f"稳定文物ID映射与作者卡不一致：{card['code']}")
    for key in ("package_id", "category"):
        _required_text(mapping.get(key), f"{card['code']}.{key}")
    prefix = "iq.abbasid." if card["code"] == "C01" else "cn.tang."
    if not str(card["id"]).startswith(prefix):
        raise TangCardImportError(f"作者卡命名空间与映射分包不符：{card['code']}")
    if not isinstance(card.get("time_range"), dict):
        raise TangCardImportError(f"作者卡断代区间无效：{card['code']}")


def _candidate_exclusion_reason(card: dict[str, Any]) -> str | None:
    time_range = card["time_range"]
    if not isinstance(time_range.get("start_year"), int) or not isinstance(
        time_range.get("end_year"), int
    ):
        if time_range.get("precision") in {
            "unknown",
            "catalog_conflict",
            "before_year",
            "approximate_anchor",
        }:
            return "日期字段无法映射为Schema整数范围；保留原始日期标签，不推造日期"
        raise TangCardImportError(f"作者卡断代区间无效：{card['code']}")
    missing = [
        key
        for key in ("title", "museum", "accession", "material")
        if not isinstance(card.get(key), str) or not card[key].strip()
    ]
    if missing:
        return "Schema必需字段待补：" + ", ".join(missing)
    return None


def _schema_time_range(card: dict[str, Any]) -> dict[str, Any]:
    authored = dict(card["time_range"])
    precision = authored.get("precision")
    normalized = {
        "catalog_range": "range",
        "century_with_qualifier": "century",
    }.get(precision, precision)
    result: dict[str, Any] = {
        "start_year": authored["start_year"],
        "end_year": authored["end_year"],
        "precision": normalized,
    }
    display_label = card.get("date_label")
    if isinstance(display_label, str) and display_label:
        result["display_label"] = display_label
    if normalized != precision:
        result["calendar_note"] = f"作者稿精度标记：{precision}；保留原始年代标签供审核。"
    return result


def _records(document: dict[str, Any], key: str, filename: str) -> list[dict[str, Any]]:
    rows = document.get(key)
    if not isinstance(rows, list) or any(not isinstance(item, dict) for item in rows):
        raise TangCardImportError(f"{filename}中{key}必须是对象数组")
    return rows


def _unique_by_id(rows: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        identifier = _required_id(row, label)
        if identifier in result:
            raise TangCardImportError(f"{label}ID重复：{identifier}")
        result[identifier] = row
    return result


def _namespace_package(identifier: str, grouped: dict[str, list[Any]]) -> str | None:
    for package_id in grouped:
        namespace = package_id.rsplit(".", 1)[0]
        if identifier.startswith(f"{namespace}."):
            return package_id
    return None


def _package_directory(package_id: str) -> str:
    if package_id == "cn.tang.core":
        return "cn-tang"
    if package_id == "iq.abbasid.core":
        return "iq-abbasid"
    raise TangCardImportError(f"ID映射中存在未支持的候选包：{package_id}")


def _safe_stem(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value):
        raise TangCardImportError(f"文件标识不安全：{value}")
    return value.lower()


def _id_stem(identifier: str) -> str:
    parts = identifier.split(".")
    stem = "-".join(parts[3:]) if len(parts) > 3 else "-".join(parts)
    return _safe_stem(stem)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise TangCardImportError(f"无法读取作者输入：{path.name}") from error
    if not isinstance(value, dict):
        raise TangCardImportError(f"作者输入必须是对象：{path.name}")
    return value


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as error:
        raise TangCardImportError("无法读取稳定ID映射表") from error
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise TangCardImportError("稳定ID映射表必须是schema_version为1的对象")
    return value


def _existing_directory(path: Path, label: str) -> Path:
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise TangCardImportError(f"{label}不可读") from error
    if not resolved.is_dir():
        raise TangCardImportError(f"{label}不是目录")
    return resolved


def _required_id(value: dict[str, Any], label: str) -> str:
    identifier = value.get("id")
    if not isinstance(identifier, str) or not re.fullmatch(r"[a-z][a-z0-9.-]{2,127}", identifier):
        raise TangCardImportError(f"{label}缺少有效稳定ID")
    return identifier


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TangCardImportError(f"缺少必需文本：{label}")
    return value.strip()


def _string_list(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise TangCardImportError(f"必须是字符串数组：{label}")
    return value


def _fact_grade(value: object, label: str) -> str:
    if not isinstance(value, str) or value not in {"F", "R", "C", "U"}:
        raise TangCardImportError(f"事实等级无效：{label}")
    return str(value)


def _write_candidate_documents(
    output: Path, documents: dict[str, Any], *, source_root: Path
) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    if source_root in output.resolve().parents:
        raise TangCardImportError("候选输出不得写入作者源目录")
    state_path = output / ".import-state.json"
    prior: dict[str, str] = {}
    if state_path.exists():
        state = _read_json(state_path)
        hashes = state.get("sha256_by_path")
        if not isinstance(hashes, dict) or any(
            not isinstance(k, str) or not isinstance(v, str) for k, v in hashes.items()
        ):
            raise TangCardImportError("上次导入状态文件无效")
        prior = hashes

    conflicts: list[str] = []
    generated: dict[str, bytes] = {}
    for relative, document in documents.items():
        payload = (
            json.dumps(document, ensure_ascii=False, indent=2) + "\n"
            if relative.endswith(".json")
            else yaml.safe_dump(document, allow_unicode=True, sort_keys=False)
        ).encode("utf-8")
        generated[relative] = payload
        target = (output / relative).resolve()
        if not target.is_relative_to(output.resolve()):
            raise TangCardImportError(f"候选输出路径越界：{relative}")
        if target.exists():
            current_hash = _sha256(target.read_bytes())
            expected_hash = prior.get(relative)
            if current_hash != _sha256(payload) and current_hash != expected_hash:
                conflicts.append(relative)

    if conflicts:
        return {
            "status": "conflict_not_overwritten",
            "written": [],
            "conflicts": conflicts,
            "candidate_root": str(output),
        }

    for relative, payload in generated.items():
        target = output / relative
        if target.exists() and target.read_bytes() == payload:
            continue
        _atomic_write(target, payload)
    state = {
        "schema_version": 1,
        "sha256_by_path": {key: _sha256(value) for key, value in generated.items()},
    }
    _atomic_write(
        state_path, (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    )
    return {
        "status": "candidate_not_published",
        "written": sorted(generated),
        "conflicts": [],
        "candidate_root": str(output),
    }


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
        os.replace(temporary, path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()
