from __future__ import annotations

import json
from pathlib import Path

import yaml
from content_pipeline import cli
from content_pipeline.build.compiler import compile_pack
from content_pipeline.importers.tang_cards import import_tang_card_candidates

CARD_CODES = [
    "A01",
    "A02",
    "A03",
    "A04",
    "A07",
    "A08",
    "A09",
    "A10",
    "A11a",
    "A11b",
    "A12",
    "C01",
    "R01",
    "R02",
    "R03",
    "R04",
    "R05",
    "R06",
    "R07",
    "R08",
]


def _fixture_bundle(root: Path) -> tuple[Path, Path]:
    source = root / "content"
    cards_dir = source / "cards"
    cards_dir.mkdir(parents=True)
    mapping: dict[str, dict[str, str]] = {}
    cards = []
    sources = []
    facts = []
    for index, code in enumerate(CARD_CODES):
        namespace = "iq.abbasid" if code == "C01" else "cn.tang"
        artifact_id = f"{namespace}.artifact.{code.lower()}"
        story_id = f"{namespace}.story.{code.lower()}"
        source_id = f"{namespace}.source.{code.lower()}-catalog"
        fact_id = f"{namespace}.fact.{code.lower()}.catalog"
        card = {
            "code": code,
            "id": artifact_id,
            "title": f"作者文物{code}",
            "museum": "测试博物馆",
            "accession": f"TEST-{code}",
            "time_range": {
                "start_year": 618 if code == "A01" else 700 + index,
                "end_year": 906 if code == "A01" else 700 + index,
                "precision": "catalog_range" if code == "A01" else "year",
            },
            "date_label": "唐代，馆方断代618—906年" if code == "A01" else f"{700 + index}年",
            "material": "陶",
            "primary_source": "https://example.org/catalog",
            "source_ids": [source_id],
            "identity_unknown": True,
            "story": {
                "id": story_id,
                "title": f"故事{code}",
                "segments": [
                    {
                        "id": f"{story_id}.segment-1",
                        "title": "开始",
                        "narration_text": "这是明确标记为现代创作的故事片段。",
                        "grade": "C",
                        "scene_asset_id": f"{namespace}.scene.{code.lower()}.v1",
                        "next_segment_id": f"{story_id}.segment-2",
                    },
                    {
                        "id": f"{story_id}.segment-2",
                        "title": "返回",
                        "narration_text": "故事结束后返回展厅。",
                        "grade": "C",
                        "scene_asset_id": f"{namespace}.scene.{code.lower()}.v1",
                        "next_segment_id": None,
                    },
                ],
                "return_target": {"type": "artifact", "artifact_id": artifact_id},
            },
        }
        if code == "A08":
            card["time_range"] = {
                "start_year": None,
                "end_year": None,
                "precision": "catalog_conflict",
            }
            card["date_label"] = "模型标唐代；馆方页面年代字段存在冲突"
        if code == "A12":
            card["accession"] = ""
        (cards_dir / f"{code.lower()}.json").write_text(
            json.dumps(card, ensure_ascii=False), encoding="utf-8"
        )
        cards.append(card)
        mapping[code] = {
            "package_id": f"{namespace}.core",
            "artifact_id": artifact_id,
            "category": "陶器",
        }
        sources.append(
            {
                "id": source_id,
                "title": f"馆藏记录{code}",
                "url": "https://example.org/catalog",
                "type": "museum_catalog",
                "checked_on": "2026-10-24",
            }
        )
        facts.append(
            {
                "id": fact_id,
                "claim": f"文物{code}的作者卡事实陈述。",
                "grade": "F",
                "source_ids": [source_id],
            }
        )
    timeline = {
        "id": "cn.tang.timeline.main.v1",
        "title": "唐朝",
        "chapters": [
            {
                "id": f"cn.tang.chapter.t{chapter:02d}",
                "legacy_id": f"T{chapter:02d}",
                "artifact_ids": [cards[chapter - 1]["id"]],
                "nodes": [
                    {"id": f"cn.tang.node.t{chapter:02d}.n{node:02d}"} for node in range(1, 5)
                ],
            }
            for chapter in range(1, 11)
        ],
    }
    _write_json(source / "timeline.json", timeline)
    _write_json(source / "fact-cards.json", {"fact_cards": facts})
    _write_json(source / "sources.json", {"sources": sources})
    _write_json(
        source / "history-sources.json",
        {
            "sources": [
                {
                    "id": "cn.tang.source.history-h01",
                    "legacy_id": "H01",
                    "links": [{"title": "编年史", "url": "https://example.org/history"}],
                }
            ]
        },
    )
    _write_json(
        source / "people.json",
        {"characters": [{"id": f"cn.tang.person.t{i:02d}"} for i in range(1, 11)]},
    )
    _write_json(
        source / "historical-people.json",
        {"people": [{"id": f"cn.tang.historical-person.h{i:02d}"} for i in range(1, 11)]},
    )
    _write_json(
        source / "scene-bindings.json",
        {
            "artifact_story_assets": {
                card["code"]: card["story"]["segments"][0]["scene_asset_id"] for card in cards
            }
        },
    )
    id_map = root / "id-map.yaml"
    id_map.write_text(
        yaml.safe_dump({"schema_version": 1, "cards": mapping}, allow_unicode=True),
        encoding="utf-8",
    )
    return source, id_map


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def test_imports_schema_candidates_without_publishing_assets(tmp_path: Path) -> None:
    source, id_map = _fixture_bundle(tmp_path)
    output = tmp_path / "candidate"

    result = import_tang_card_candidates(
        source_root=source, candidate_root=output, id_map_path=id_map
    )

    assert result["status"] == "candidate_not_published"
    assert len(result["written"]) > 100
    assert (output / "cn-tang" / "manifest.yaml").is_file()
    assert (output / "iq-abbasid" / "artifacts" / "c01.yaml").is_file()
    assert not list(output.rglob("*.png"))
    for package in (output / "cn-tang", output / "iq-abbasid"):
        issues, documents = compile_pack(package)
        assert issues == []
        assert documents is not None
    index = json.loads((output / "authoring-index.json").read_text(encoding="utf-8"))
    assert index["status"] == "candidate_not_published"
    assert len(index["timeline_chapters"]) == 10
    assert len(index["scene_asset_ids"]) == 20
    assert len(index["timeline_chapters"][0]["nodes"]) == 4
    assert index["story_scene_bindings"]["A01"] == "cn.tang.scene.a01.v1"
    assert {item["code"] for item in index["deferred_cards"]} == {"A08", "A12"}
    a01 = yaml.safe_load(
        (output / "cn-tang" / "artifacts" / "a01.yaml").read_text(encoding="utf-8")
    )
    assert a01["time_range"]["precision"] == "range"
    assert a01["time_range"]["display_label"] == "唐代，馆方断代618—906年"
    assert not (output / "cn-tang" / "artifacts" / "a08.yaml").exists()


def test_import_is_idempotent_and_does_not_overwrite_manual_candidate_edits(
    tmp_path: Path,
) -> None:
    source, id_map = _fixture_bundle(tmp_path)
    output = tmp_path / "candidate"
    import_tang_card_candidates(source_root=source, candidate_root=output, id_map_path=id_map)
    target = output / "cn-tang" / "artifacts" / "a01.yaml"
    original = target.read_text(encoding="utf-8")

    second = import_tang_card_candidates(
        source_root=source, candidate_root=output, id_map_path=id_map
    )
    assert second["conflicts"] == []
    assert target.read_text(encoding="utf-8") == original

    target.write_text(original + "# 手工审核备注\n", encoding="utf-8")
    conflict = import_tang_card_candidates(
        source_root=source, candidate_root=output, id_map_path=id_map
    )
    assert conflict["status"] == "conflict_not_overwritten"
    assert "cn-tang/artifacts/a01.yaml" in conflict["conflicts"]
    assert target.read_text(encoding="utf-8").endswith("# 手工审核备注\n")


def test_cli_dispatches_tang_card_candidate_import(tmp_path: Path, monkeypatch, capsys) -> None:
    def fake_import(*, source_root, candidate_root, id_map_path):
        return {
            "status": "candidate_not_published",
            "written": ["cn-tang/manifest.yaml"],
            "conflicts": [],
        }

    monkeypatch.setattr(cli, "import_tang_card_candidates", fake_import)
    result = cli.main(
        [
            "import-tang-cards-candidate",
            "--source-root",
            str(tmp_path / "source"),
            "--candidate-root",
            str(tmp_path / "candidate"),
            "--id-map",
            str(tmp_path / "id-map.yaml"),
        ]
    )

    assert result == 0
    assert "candidate_not_published" in capsys.readouterr().out
