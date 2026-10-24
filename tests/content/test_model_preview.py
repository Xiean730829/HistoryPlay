from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

import pytest
from content_pipeline.assets.model_preview import render_preview
from content_pipeline.assets.preview_manifest import (
    PreviewInputError,
    record_preview,
    record_preview_batch,
)
from content_pipeline.cli import main


def _png(width: int = 2, height: int = 3, *, corrupt_pixels: bool = False) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    pixels = (
        b"not a zlib stream"
        if corrupt_pixels
        else b"".join(b"\x00" + bytes([32, 64, 96, 255] * width) for _ in range(height))
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", pixels if corrupt_pixels else zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )


def _glb(path: Path) -> None:
    document = json.dumps({"asset": {"version": "2.0"}}, separators=(",", ":")).encode("utf-8")
    document += b" " * ((-len(document)) % 4)
    path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 20 + len(document))
        + struct.pack("<I4s", len(document), b"JSON")
        + document
    )


def _framing() -> dict[str, object]:
    return {
        "camera_location": [2, -3, 1],
        "target": [0, 0, 0],
        "orthographic_scale": 3.2,
        "resolution": [64, 64],
        "transparent_background": True,
        "environment": {"preset": "museum-neutral-v1", "color_management": "Standard"},
    }


def _record(tmp_path: Path, **overrides: object) -> tuple[Path, Path, Path, dict[str, object]]:
    model = tmp_path / "source.glb"
    preview = tmp_path / "preview.png"
    manifest = tmp_path / "manifest.json"
    _glb(model)
    preview.write_bytes(_png(64, 64))
    values: dict[str, object] = {
        "manifest_path": manifest,
        "asset_id": "cn.tang.asset.test.glb",
        "preview_asset_id": "cn.tang.asset.test.preview",
        "model_path": model,
        "preview_path": preview,
        "renderer": "Blender",
        "renderer_version": "4.2.0",
        "attribution": "Museum model source; CC0",
        "framing": _framing(),
    }
    values.update(overrides)
    return model, preview, manifest, values


def test_records_hashes_framing_and_no_local_paths(tmp_path: Path) -> None:
    model, preview, manifest, values = _record(tmp_path)

    assert record_preview(**values) is True
    content = manifest.read_text(encoding="utf-8")
    result = json.loads(content)["previews"][0]
    assert result["model_sha256"]
    assert result["preview_sha256"]
    assert result["dimensions"] == [64, 64]
    assert result["renderer_version"] == "4.2.0"
    assert result["preview_asset_id"] == "cn.tang.asset.test.preview"
    assert result["framing"]["orthographic_scale"] == 3.2
    assert str(model) not in content
    assert str(preview) not in content


def test_identical_input_reuses_existing_record(tmp_path: Path) -> None:
    _, _, manifest, values = _record(tmp_path)
    assert record_preview(**values) is True
    before = manifest.read_bytes()

    assert record_preview(**values) is False
    assert manifest.read_bytes() == before


def test_preview_id_cannot_be_reassigned_to_another_model(tmp_path: Path) -> None:
    _model, _preview, manifest, values = _record(tmp_path)
    record_preview(**values)
    other_model = tmp_path / "other.glb"
    _glb(other_model)

    with pytest.raises(PreviewInputError, match="已绑定到其他文物"):
        record_preview(
            **{**values, "asset_id": "cn.tang.asset.other.glb", "model_path": other_model}
        )

    assert (
        json.loads(manifest.read_text(encoding="utf-8"))["previews"][0]["asset_id"]
        == values["asset_id"]
    )


def test_same_model_can_replace_preview_id_without_duplicate_record(tmp_path: Path) -> None:
    _, _, manifest, values = _record(tmp_path)
    record_preview(**values)

    assert record_preview(**{**values, "preview_asset_id": "cn.tang.asset.test.preview.v2"}) is True
    records = json.loads(manifest.read_text(encoding="utf-8"))["previews"]
    assert len(records) == 1
    assert records[0]["preview_asset_id"] == "cn.tang.asset.test.preview.v2"


def test_batch_is_atomic_when_later_preview_is_invalid(tmp_path: Path) -> None:
    (tmp_path / "first").mkdir()
    (tmp_path / "second").mkdir()
    first_model, first_preview, manifest, first = _record(tmp_path / "first")
    second_model, second_preview, _, second = _record(tmp_path / "second")
    second_preview.write_bytes(b"broken")
    initial = {key: value for key, value in first.items() if key != "manifest_path"}
    invalid = {key: value for key, value in second.items() if key != "manifest_path"}
    invalid["asset_id"] = "cn.tang.asset.second.glb"
    invalid["preview_asset_id"] = "cn.tang.asset.second.preview"

    with pytest.raises(PreviewInputError, match="PNG"):
        record_preview_batch(manifest_path=manifest, items=[initial, invalid])

    assert not manifest.exists()
    assert first_model.is_file() and first_preview.is_file() and second_model.is_file()


def test_batch_rejects_duplicate_asset_and_preview_ids(tmp_path: Path) -> None:
    _, _, manifest, values = _record(tmp_path)
    item = {key: value for key, value in values.items() if key != "manifest_path"}

    with pytest.raises(PreviewInputError, match="不得重复"):
        record_preview_batch(manifest_path=manifest, items=[item, item])

    assert not manifest.exists()


def test_batch_registers_entries_with_relative_paths(tmp_path: Path) -> None:
    asset_dir = tmp_path / "assets"
    asset_dir.mkdir()
    model, preview, _, values = _record(asset_dir)
    batch = tmp_path / "batch.json"
    batch.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "previews": [
                    {
                        "asset_id": values["asset_id"],
                        "preview_asset_id": values["preview_asset_id"],
                        "model_path": "assets/source.glb",
                        "preview_path": "assets/preview.png",
                        "renderer": values["renderer"],
                        "renderer_version": values["renderer_version"],
                        "attribution": values["attribution"],
                        "framing": values["framing"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    manifest = tmp_path / "manifest.json"

    assert main(["batch-record-preview", "--batch", str(batch), "--manifest", str(manifest)]) == 0
    content = manifest.read_text(encoding="utf-8")
    assert json.loads(content)["previews"][0]["asset_id"] == values["asset_id"]
    assert str(model) not in content and str(preview) not in content


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"framing": {**_framing(), "resolution": [5000, 5000]}}, "resolution"),
        ({"renderer_version": ""}, "版本"),
    ],
)
def test_invalid_preview_input_does_not_write_manifest(
    tmp_path: Path, overrides: dict[str, object], message: str
) -> None:
    _, _, manifest, values = _record(tmp_path, **overrides)

    with pytest.raises(PreviewInputError, match=message):
        record_preview(**values)
    assert not manifest.exists()


def test_corrupt_png_and_mismatched_glb_are_rejected(tmp_path: Path) -> None:
    model, preview, manifest, values = _record(tmp_path)
    preview.write_bytes(b"not a png")
    with pytest.raises(PreviewInputError, match="PNG"):
        record_preview(**values)

    preview.write_bytes(_png(64, 64))
    model.write_bytes(struct.pack("<4sII", b"glTF", 2, 99))
    with pytest.raises(PreviewInputError, match="GLB"):
        record_preview(**values)
    assert not manifest.exists()


def test_png_with_valid_chunk_crc_but_invalid_pixels_is_rejected(tmp_path: Path) -> None:
    _, preview, manifest, values = _record(tmp_path)
    preview.write_bytes(_png(64, 64, corrupt_pixels=True))

    with pytest.raises(PreviewInputError, match="解压"):
        record_preview(**values)

    assert not manifest.exists()


def test_cli_records_preview_from_an_explicit_manual_export(tmp_path: Path) -> None:
    model, preview, manifest, _ = _record(tmp_path)
    framing = tmp_path / "framing.json"
    framing.write_text(json.dumps(_framing()), encoding="utf-8")

    assert (
        main(
            [
                "record-preview",
                "--asset-id",
                "cn.tang.asset.test.glb",
                "--preview-asset-id",
                "cn.tang.asset.test.preview",
                "--model",
                str(model),
                "--preview",
                str(preview),
                "--manifest",
                str(manifest),
                "--renderer",
                "Blender",
                "--renderer-version",
                "4.2.0",
                "--attribution",
                "Museum model source; CC0",
                "--framing",
                str(framing),
            ]
        )
        == 0
    )
    assert manifest.is_file()


def test_blender_renderer_requires_exact_pinned_version_and_renders_real_glb(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from content_pipeline.assets import model_preview

    model, _, manifest, values = _record(tmp_path)
    renderer = tmp_path / "blender"
    renderer.touch()
    preview = tmp_path / "rendered.png"
    calls: list[list[str]] = []

    def fake_run(command: list[str], timeout: int = 30):
        calls.append(command)
        if command[-1] == "--version":
            return model_preview.subprocess.CompletedProcess(command, 0, "Blender 4.2.0", "")
        output_path = Path(command[command.index("--") + 2])
        output_path.write_bytes(_png(64, 64))
        return model_preview.subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(model_preview, "_run", fake_run)
    assert (
        render_preview(
            renderer_path=renderer,
            expected_version="4.2.0",
            model_path=model,
            preview_path=preview,
            manifest_path=manifest,
            asset_id=str(values["asset_id"]),
            preview_asset_id=str(values["preview_asset_id"]),
            attribution=str(values["attribution"]),
            framing=values["framing"],
        )
        is True
    )
    assert preview.is_file()
    assert json.loads(manifest.read_text(encoding="utf-8"))["previews"][0]["model_sha256"]
    assert len(calls) == 2
    assert str(model.resolve()) in calls[1]


def test_blender_failure_or_version_mismatch_never_registers_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from content_pipeline.assets import model_preview

    model, _, manifest, values = _record(tmp_path)
    renderer = tmp_path / "blender"
    renderer.touch()
    calls = 0

    def wrong_version(command: list[str], timeout: int = 30):
        nonlocal calls
        calls += 1
        return model_preview.subprocess.CompletedProcess(command, 0, "Blender 4.1.1", "")

    monkeypatch.setattr(model_preview, "_run", wrong_version)
    with pytest.raises(PreviewInputError, match="版本不匹配"):
        render_preview(
            renderer_path=renderer,
            expected_version="4.2.0",
            model_path=model,
            preview_path=tmp_path / "rendered.png",
            manifest_path=manifest,
            asset_id=str(values["asset_id"]),
            preview_asset_id=str(values["preview_asset_id"]),
            attribution=str(values["attribution"]),
            framing=values["framing"],
        )
    assert calls == 1
    assert not manifest.exists()
    assert not (tmp_path / "rendered.png").exists()


def test_blender_process_failure_never_registers_preview(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from content_pipeline.assets import model_preview

    model, _, manifest, values = _record(tmp_path)
    renderer = tmp_path / "blender"
    renderer.touch()
    calls = 0

    def failed_render(command: list[str], timeout: int = 30):
        nonlocal calls
        calls += 1
        if command[-1] == "--version":
            return model_preview.subprocess.CompletedProcess(command, 0, "Blender 4.2.0", "")
        return model_preview.subprocess.CompletedProcess(command, 1, "", "render error")

    monkeypatch.setattr(model_preview, "_run", failed_render)
    with pytest.raises(PreviewInputError, match="渲染失败"):
        render_preview(
            renderer_path=renderer,
            expected_version="4.2.0",
            model_path=model,
            preview_path=tmp_path / "rendered.png",
            manifest_path=manifest,
            asset_id=str(values["asset_id"]),
            preview_asset_id=str(values["preview_asset_id"]),
            attribution=str(values["attribution"]),
            framing=values["framing"],
        )
    assert calls == 2
    assert not manifest.exists()
    assert not (tmp_path / "rendered.png").exists()
