from __future__ import annotations

import json
from pathlib import Path

from content_pipeline.build.compiler import compile_pack, write_documents
from content_pipeline.cli import main
from test_reference_validator import write_pack


def test_compile_pack_returns_json_documents(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    issues, documents = compile_pack(pack)
    assert issues == []
    assert documents is not None
    assert documents["manifest.json"]["id"] == "cn.tang.core"
    assert documents["nodes/01.json"]["story_id"] == "cn.tang.story.stele-observation"


def test_write_documents_preserves_utf8_and_layout(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    issues, documents = compile_pack(pack)
    assert not issues
    assert documents is not None
    out = tmp_path / "runtime"
    write_documents(out, documents)
    result = json.loads((out / "artifacts/stele.json").read_text(encoding="utf-8"))
    assert result["title"] == "一佛二菩萨造像碑"


def test_compile_pack_rejects_invalid_references(tmp_path: Path) -> None:
    pack = write_pack(
        tmp_path,
        artifact=(
            "id: cn.tang.artifact.stele\n"
            "title: 碑\n"
            "museum:\n"
            "  name: Museum\n"
            "  accession: a\n"
            "time_range:\n"
            "  start_year: 678\n"
            "  end_year: 678\n"
            "  precision: year\n"
            "material: 石\n"
            "category: 碑\n"
            "asset_ids:\n"
            "  - cn.tang.asset.missing\n"
        ),
    )
    issues, documents = compile_pack(pack)
    assert documents is None
    assert any("缺少引用" in issue.message for issue in issues)


def test_cli_build_writes_candidate_pack(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    out = tmp_path / "out"
    assert main(["build", "--pack", str(pack), "--out", str(out)]) == 0
    assert (out / "manifest.json").is_file()
