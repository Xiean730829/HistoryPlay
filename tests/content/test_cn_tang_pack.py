from pathlib import Path

from content_pipeline.cli import main

PACK = Path(__file__).resolve().parents[2] / "content-src" / "packs" / "cn-tang"


def test_draft_tang_gallery_pack_validates_and_builds(tmp_path: Path) -> None:
    assert main(["validate", "--pack", str(PACK)]) == 0
    assert main(["build", "--pack", str(PACK), "--out", str(tmp_path / "candidate")]) == 0


def test_gallery_keeps_three_distinct_primary_artifacts() -> None:
    import yaml

    gallery = yaml.safe_load((PACK / "galleries" / "main.yaml").read_text(encoding="utf-8"))
    stations = gallery["stations"]
    assert [station["order"] for station in stations] == [0, 1, 2]
    assert len({station["artifact_id"] for station in stations}) == 3
    assert len({station["side"] for station in stations}) == 3
