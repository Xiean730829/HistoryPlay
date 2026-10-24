from pathlib import Path

import yaml

from content_pipeline.cli import main

PACK = Path(__file__).resolve().parents[2] / "content-src" / "packs" / "cn-tang"


def load_yaml(relative: str) -> dict:
    return yaml.safe_load((PACK / relative).read_text(encoding="utf-8"))


def test_draft_tang_gallery_pack_validates_and_builds(tmp_path: Path) -> None:
    manifest = load_yaml("manifest.yaml")
    assert manifest["version"] == "0.2.0"
    assert manifest["publication_status"] == "draft"
    assert main(["validate", "--pack", str(PACK)]) == 0
    assert main(["build", "--pack", str(PACK), "--out", str(tmp_path / "candidate")]) == 0


def test_gallery_keeps_three_distinct_primary_artifacts() -> None:
    gallery = load_yaml("galleries/main.yaml")
    stations = gallery["stations"]
    assert [station["order"] for station in stations] == [0, 1, 2]
    assert [station["artifact_id"] for station in stations] == [
        "cn.tang.artifact.votive-stele",
        "cn.tang.artifact.kaiyuan-coin",
        "cn.tang.artifact.gilt-bronze-bull",
    ]
    assert len({station["artifact_id"] for station in stations}) == 3
    assert len({station["side"] for station in stations}) == 3
    assert "制作先后" in stations[1]["placement_basis"]
    assert "策展顺序" in stations[2]["placement_basis"]


def test_coin_keeps_specimen_date_apart_from_type_start() -> None:
    coin = load_yaml("artifacts/kaiyuan-coin.yaml")
    specimen = load_yaml("facts/kaiyuan-specimen-date.yaml")
    type_start = load_yaml("facts/kaiyuan-type-start.yaml")
    assert coin["time_range"]["start_year"] == 718
    assert coin["time_range"]["end_year"] == 732
    assert specimen["applicable_time"]["start_year"] == 718
    assert specimen["applicable_time"]["end_year"] == 732
    assert type_start["applicable_time"]["start_year"] == 621
    assert type_start["applicable_time"]["end_year"] == 621
    assert specimen["id"] in coin["fact_card_ids"]
    assert type_start["id"] in coin["fact_card_ids"]
    assert "621" in coin["time_range"]["uncertainty"]


def test_bull_keeps_century_dating_and_does_not_name_an_owner() -> None:
    bull = load_yaml("artifacts/gilt-bronze-bull.yaml")
    dated = load_yaml("facts/gilt-bronze-bull-date.yaml")
    use = load_yaml("facts/gilt-bronze-bull-use.yaml")
    node = load_yaml("nodes/gilt-bronze-bull-01.yaml")
    assert bull["time_range"]["precision"] == "century"
    assert bull["time_range"]["start_year"] == 700
    assert bull["time_range"]["end_year"] == 799
    assert dated["applicable_time"]["precision"] == "century"
    assert "不指认具体使用者" in use["evidence_note"]
    assert "并没有指明某一位具体使用者" in node["narration"]
