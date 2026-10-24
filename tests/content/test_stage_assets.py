from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path

from content_pipeline.assets.stage_assets import AssetStageError, stage_assets
from content_pipeline.cli import main
from test_reference_validator import ASSET, write_pack

PREVIEW_BYTES = b"\x89PNG\r\n\x1a\npreview-bytes"
PREVIEW_HASH = sha256(PREVIEW_BYTES).hexdigest()
PREVIEW_ASSET = ASSET.replace("cn.tang.asset.stele.original", "cn.tang.asset.stele.preview").replace(
    "kind: model3d\nformat: glb", "kind: preview\nformat: png"
).replace(
    "sha256: 9df4392c5d16e92fd704737f4037be19b55e69b28635ec3d47142e5180d87ed4",
    f"sha256: {PREVIEW_HASH}",
).replace("byte_size: 4855856", f"byte_size: {len(PREVIEW_BYTES)}")


def _sources(tmp_path: Path, mapping: dict[str, Path]) -> Path:
    path = tmp_path / "sources.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "sources": {key: str(value) for key, value in mapping.items()},
            }
        ),
        encoding="utf-8",
    )
    return path


def test_stage_assets_copies_hash_addressed_bytes(tmp_path: Path) -> None:
    pack = write_pack(tmp_path / "pack", extra_assets=[PREVIEW_ASSET])
    preview = tmp_path / "votive-stele.png"
    preview.write_bytes(PREVIEW_BYTES)
    sources = _sources(tmp_path, {"cn.tang.asset.stele.preview": preview})
    dest = stage_assets(pack_dir=pack, sources_path=sources, out_root=tmp_path / "assets")
    stored = dest / "files" / f"{PREVIEW_HASH}.png"
    assert stored.read_bytes() == PREVIEW_BYTES
    index = json.loads((dest / "asset-index.json").read_text(encoding="utf-8"))
    assert index["assets"]["cn.tang.asset.stele.preview"]["sha256"] == PREVIEW_HASH
    assert str(preview) not in (dest / "asset-index.json").read_text(encoding="utf-8")


def test_stage_assets_rejects_hash_mismatch_and_overwrite(tmp_path: Path) -> None:
    pack = write_pack(tmp_path / "pack", extra_assets=[PREVIEW_ASSET])
    preview = tmp_path / "votive-stele.png"
    preview.write_bytes(b"not-the-preview")
    sources = _sources(tmp_path, {"cn.tang.asset.stele.preview": preview})
    try:
        stage_assets(pack_dir=pack, sources_path=sources, out_root=tmp_path / "assets")
        raise AssertionError("expected hash mismatch")
    except AssetStageError as error:
        assert "哈希" in str(error) or "大小" in str(error)
    preview.write_bytes(PREVIEW_BYTES)
    dest = stage_assets(pack_dir=pack, sources_path=sources, out_root=tmp_path / "assets")
    try:
        stage_assets(pack_dir=pack, sources_path=sources, out_root=tmp_path / "assets")
        raise AssertionError("expected overwrite rejection")
    except AssetStageError as error:
        assert "不可覆盖" in str(error)
    assert dest.is_dir()


def test_stage_assets_require_all_fails_when_source_missing(tmp_path: Path) -> None:
    pack = write_pack(tmp_path / "pack", extra_assets=[PREVIEW_ASSET])
    preview = tmp_path / "votive-stele.png"
    preview.write_bytes(PREVIEW_BYTES)
    sources = _sources(tmp_path, {"cn.tang.asset.stele.preview": preview})
    try:
        stage_assets(
            pack_dir=pack,
            sources_path=sources,
            out_root=tmp_path / "assets",
            require_all=True,
        )
        raise AssertionError("expected missing source GLB")
    except AssetStageError as error:
        assert "缺文件" in str(error)


def test_cli_stage_assets_writes_version_dir(tmp_path: Path) -> None:
    pack = write_pack(tmp_path / "pack", extra_assets=[PREVIEW_ASSET])
    preview = tmp_path / "votive-stele.png"
    preview.write_bytes(PREVIEW_BYTES)
    sources = _sources(tmp_path, {"cn.tang.asset.stele.preview": preview})
    out = tmp_path / "staged"
    assert (
        main(
            [
                "stage-assets",
                "--pack",
                str(pack),
                "--sources",
                str(sources),
                "--out",
                str(out),
            ]
        )
        == 0
    )
    assert (out / "cn.tang.core" / "0.1.0" / "asset-index.json").is_file()
