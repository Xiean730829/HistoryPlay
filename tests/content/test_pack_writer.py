from __future__ import annotations

from pathlib import Path

from content_pipeline.build.compiler import compile_pack
from content_pipeline.build.pack_writer import read_index, write_immutable_pack
from content_pipeline.cli import main
from test_reference_validator import write_pack


def test_write_immutable_pack_creates_version_dir(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    issues, documents = compile_pack(pack)
    assert not issues
    assert documents is not None
    write_issues, dest = write_immutable_pack(tmp_path / "published", documents)
    assert write_issues == []
    assert dest is not None
    assert dest == tmp_path / "published" / "cn.tang.core" / "0.1.0"
    index = read_index(dest)
    assert index["id"] == "cn.tang.core"
    assert index["version"] == "0.1.0"
    assert "manifest.json" in index["files"]
    assert (dest / "manifest.json").is_file()
    assert (dest / "pack-index.json").is_file()


def test_write_immutable_pack_rejects_overwrite(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    _issues, documents = compile_pack(pack)
    assert documents is not None
    first, dest = write_immutable_pack(tmp_path / "published", documents)
    assert first == []
    assert dest is not None
    (dest / "marker.txt").write_text("keep", encoding="utf-8")
    second, again = write_immutable_pack(tmp_path / "published", documents)
    assert again is None
    assert any("不可覆盖" in issue.message for issue in second)
    assert (dest / "marker.txt").read_text(encoding="utf-8") == "keep"


def test_cli_stage_writes_version_dir(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    out = tmp_path / "published"
    assert main(["stage", "--pack", str(pack), "--out", str(out)]) == 0
    assert (out / "cn.tang.core" / "0.1.0" / "pack-index.json").is_file()
    assert main(["stage", "--pack", str(pack), "--out", str(out)]) == 1
