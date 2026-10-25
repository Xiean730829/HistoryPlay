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
        display = artifact["presentation"]["display"]
        assert display["kind"] == "model3d"
        assert display["asset_id"].endswith(".display")
        assert display["asset_id"] != source_id


def test_three_display_models_are_derived_and_not_source_lod() -> None:
    displays = [
        load_yaml("assets/votive-stele.display.yaml"),
        load_yaml("assets/kaiyuan-coin.display.yaml"),
        load_yaml("assets/gilt-bronze-bull.display.yaml"),
    ]
    expected = {
        "cn.tang.asset.votive-stele.display": (
            "cn.tang.asset.votive-stele.glb",
            "6bfdd2818663423c28a78523cdfc6e0929d403d93b091a3ba92fe2cb4dfd6bd5",
            3536876,
            "front-upright",
        ),
        "cn.tang.asset.kaiyuan-coin.display": (
            "cn.tang.asset.kaiyuan-coin.glb",
            "9c7be0d0d7c03060a91df98daf96ea476485e0434c89d421642a1c778fb04f7c",
            4839224,
            "inscription-face",
        ),
        "cn.tang.asset.gilt-bronze-bull.display": (
            "cn.tang.asset.gilt-bronze-bull.glb",
            "950a5f1079b89148fd29c5e9b4b0a9451e5b3e1ad377ec5664d56951abc62adf",
            4213088,
            "three-quarter",
        ),
    }
    assert {item["id"] for item in displays} == set(expected)
    for item in displays:
        source_id, digest, size, orbit = expected[item["id"]]
        assert item["kind"] == "model3d"
        assert item["format"] == "glb"
        assert item["lod"] == "display"
        assert item["derived_from"] == source_id
        assert item["sha256"] == digest
        assert item["byte_size"] == size
        assert item["framing"]["camera_orbit"] == orbit
        source = load_yaml(f"assets/{source_id.split('.')[-2]}.yaml")
        assert source["lod"] == "source"
        artifact = load_yaml(f"artifacts/{source_id.split('.')[-2]}.yaml")
        assert item["id"] in artifact["asset_ids"]
        assert artifact["presentation"]["display"]["asset_id"] == item["id"]
        assert artifact["presentation"]["display"]["kind"] == "model3d"


def test_three_stories_bind_dedicated_comic_frames_without_audio() -> None:
    frames = (
        (
            "votive-stele",
            "cn.tang.node.votive-stele.01",
            "cn.tang.asset.votive-stele.story-01",
            "4604992c82fb97ea9fff5ea2000bd2c1df9993192609a3158343889637ff3307",
            5216895,
            "创作的石作场景",
        ),
        (
            "votive-stele",
            "cn.tang.node.votive-stele.02",
            "cn.tang.asset.votive-stele.story-02",
            "299b7e0c751b4c15be41db486b7fdde7a41e9d9776932040a1ebea01ead8be23",
            4770618,
            "家庭是创作情境",
        ),
        (
            "kaiyuan-coin",
            "cn.tang.node.kaiyuan-coin.01",
            "cn.tang.asset.kaiyuan-coin.story-01",
            "921f92c9c29e1a6fcc92ca6cc7f920bdc56ba26b7f937af7dfe6c505e308d7cb",
            5443891,
            "创作的市集用钱场景",
        ),
        (
            "kaiyuan-coin",
            "cn.tang.node.kaiyuan-coin.02",
            "cn.tang.asset.kaiyuan-coin.story-02",
            "4687843f3bd491d0c1279ebe8856ce4cf36b4dd9cac32880070020de577c830d",
            4884082,
            "铺面里穿钱的画面是创作情境",
        ),
        (
            "gilt-bronze-bull",
            "cn.tang.node.gilt-bronze-bull.01",
            "cn.tang.asset.gilt-bronze-bull.story-01",
            "2c153f14bab08ccbad706535b5579b243fb6542c86e0e10d0215e506d0a99fd2",
            4857083,
            "创作的书案情境",
        ),
        (
            "gilt-bronze-bull",
            "cn.tang.node.gilt-bronze-bull.02",
            "cn.tang.asset.gilt-bronze-bull.story-02",
            "e24641d2af5e1834ca5524a49d9910dcae109b11c70e815521c84b226d5f3250",
            4936100,
            "压纸的动作是创作示意",
        ),
    )
    for slug, node_id, asset_id, digest, size, invented in frames:
        node = load_yaml(f"nodes/{slug}-{node_id.rsplit('.', 1)[-1]}.yaml")
        asset = load_yaml(f"assets/{slug}.story-{node_id.rsplit('.', 1)[-1]}.yaml")
        assert node["id"] == node_id
        assert node["presentation"]["capability"] == "comic"
        assert node["presentation"]["asset_ids"] == [asset_id]
        assert "audio_asset_id" not in node["presentation"]
        assert invented in node["narration"]
        assert asset["id"] == asset_id
        assert asset["kind"] == "comic"
        assert asset["format"] == "png"
        assert asset["sha256"] == digest
        assert asset["byte_size"] == size


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
