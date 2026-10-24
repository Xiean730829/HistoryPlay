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


def test_three_preview_assets_are_inventoried_without_binding_source_display() -> None:
    previews = [
        load_yaml("assets/votive-stele.preview.yaml"),
        load_yaml("assets/kaiyuan-coin.preview.yaml"),
        load_yaml("assets/gilt-bronze-bull.preview.yaml"),
    ]
    expected = {
        "cn.tang.asset.votive-stele.preview": (
            "cn.tang.asset.votive-stele.glb",
            "168b6bfeb4e07625bf265b2d6dcf0dbd7c566a40b33da1e510012c25fa078d46",
            1488044,
        ),
        "cn.tang.asset.kaiyuan-coin.preview": (
            "cn.tang.asset.kaiyuan-coin.glb",
            "21b9127342f1a4f64ac13154f5dda15abe390f7b5a9a6b6ffdba594a8f62fbc2",
            1187360,
        ),
        "cn.tang.asset.gilt-bronze-bull.preview": (
            "cn.tang.asset.gilt-bronze-bull.glb",
            "194fc122777f0e35e3c3b4732bcbd886414a57e977cf440df9494ff017e6701e",
            855092,
        ),
    }
    assert {item["id"] for item in previews} == set(expected)
    for item in previews:
        source_id, digest, size = expected[item["id"]]
        assert item["kind"] == "preview"
        assert item["format"] == "png"
        assert item["derived_from"] == source_id
        assert item["sha256"] == digest
        assert item["byte_size"] == size
        artifact = load_yaml(f"artifacts/{source_id.split('.')[-2]}.yaml")
        assert item["id"] in artifact["asset_ids"]
        assert "presentation" not in artifact


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
