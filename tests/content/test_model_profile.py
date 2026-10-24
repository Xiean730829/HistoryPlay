from __future__ import annotations

import json
import shutil
import struct
import subprocess
from pathlib import Path

import pytest
from content_pipeline.assets.model_profile import (
    ModelProfileError,
    export_display_glb,
    profile_glb,
    record_source_profile,
)
from content_pipeline.cli import main


def _glb(path: Path, *, triangles: int = 12, images: int = 1) -> None:
    document = {
        "asset": {"version": "2.0"},
        "meshes": [
            {
                "primitives": [
                    {
                        "attributes": {"POSITION": 0},
                        "indices": 1,
                        "mode": 4,
                    }
                ]
            }
        ],
        "accessors": [
            {"componentType": 5126, "count": triangles * 3, "type": "VEC3"},
            {"componentType": 5123, "count": triangles * 3, "type": "SCALAR"},
        ],
        "images": [{"mimeType": "image/png", "bufferView": index} for index in range(images)],
        "bufferViews": [{"byteOffset": 0, "byteLength": 8} for _ in range(images)],
        "buffers": [{"byteLength": 8}],
    }
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((-len(payload)) % 4)
    blob = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    header = struct.pack("<4sII", b"glTF", 2, 20 + len(payload) + 8 + len(blob))
    path.write_bytes(
        header
        + struct.pack("<I4s", len(payload), b"JSON")
        + payload
        + struct.pack("<I4s", len(blob), b"BIN\x00")
        + blob
    )


def _method() -> dict[str, object]:
    return {
        "schema_version": 1,
        "steps": [
            {"command": "simplify", "options": {"ratio": 0.5, "error": 0.01}},
            {"command": "resize", "options": {"width": 1024, "height": 1024}},
            {"command": "jpeg", "options": {"quality": 85, "slots": "baseColorTexture"}},
        ],
    }


def _orientation() -> dict[str, str]:
    return {"camera_orbit": "front-upright", "orientation_note": "正面朝-Y，佛与二菩萨直立。"}


def test_profile_counts_triangles_images_and_rejects_truncated_glb(tmp_path: Path) -> None:
    model = tmp_path / "source.glb"
    _glb(model, triangles=40, images=2)

    profile = profile_glb(model)

    assert profile["triangle_count"] == 40
    assert profile["image_count"] == 2
    assert profile["mesh_count"] == 1
    assert profile["byte_size"] == model.stat().st_size
    assert len(profile["sha256"]) == 64
    model.write_bytes(model.read_bytes()[:12])
    with pytest.raises(ModelProfileError, match="GLB"):
        profile_glb(model)


def test_record_source_profile_writes_json_without_local_path(tmp_path: Path) -> None:
    model = tmp_path / "source.glb"
    record = tmp_path / "source-profile.json"
    _glb(model)

    result = record_source_profile(model_path=model, record_path=record)

    assert result["kind"] == "source"
    assert result["triangle_count"] == 12
    content = record.read_text(encoding="utf-8")
    assert str(model) not in content
    assert json.loads(content)["model_sha256"] == result["model_sha256"]


def test_export_rejects_empty_simplify_ratio_and_missing_orientation(tmp_path: Path) -> None:
    source = tmp_path / "source.glb"
    display = tmp_path / "display.glb"
    record = tmp_path / "display-profile.json"
    cli = tmp_path / "gltf-transform.cmd"
    _glb(source)
    cli.write_text("", encoding="utf-8")
    method = _method()
    method["steps"][0]["options"]["ratio"] = 0

    with pytest.raises(ModelProfileError, match="ratio"):
        export_display_glb(
            source_path=source,
            display_path=display,
            record_path=record,
            transform_cli=cli,
            expected_version="4.5.1",
            method=method,
            orientation=_orientation(),
            note="测试",
        )
    with pytest.raises(ModelProfileError, match="朝向"):
        export_display_glb(
            source_path=source,
            display_path=display,
            record_path=record,
            transform_cli=cli,
            expected_version="4.5.1",
            method=_method(),
            orientation={"camera_orbit": "front"},
            note="测试",
        )
    assert not display.exists()
    assert not record.exists()


def test_export_rejects_source_hash_mismatch(tmp_path: Path) -> None:
    source = tmp_path / "source.glb"
    _glb(source)
    cli = tmp_path / "gltf-transform.cmd"
    cli.write_text("", encoding="utf-8")

    with pytest.raises(ModelProfileError, match="哈希"):
        export_display_glb(
            source_path=source,
            display_path=tmp_path / "display.glb",
            record_path=tmp_path / "record.json",
            transform_cli=cli,
            expected_version="4.5.1",
            method=_method(),
            orientation=_orientation(),
            note="测试",
            source_sha256="0" * 64,
        )


def test_cli_record_source_profile(tmp_path: Path) -> None:
    model = tmp_path / "source.glb"
    record = tmp_path / "source-profile.json"
    _glb(model, triangles=9)

    assert main(["record-source-profile", "--model", str(model), "--record", str(record)]) == 0
    assert json.loads(record.read_text(encoding="utf-8"))["triangle_count"] == 9


def test_export_runs_pinned_gltf_transform_and_keeps_source(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from content_pipeline.assets import model_profile

    source = tmp_path / "source.glb"
    display = tmp_path / "nested" / "display.glb"
    record = tmp_path / "display-profile.json"
    cli = tmp_path / "cli.js"
    reduced = tmp_path / "reduced.glb"
    _glb(source, triangles=40)
    _glb(reduced, triangles=12)
    cli.write_text("", encoding="utf-8")
    before = source.read_bytes()
    calls: list[list[str]] = []

    def fake_run(command: list[str], timeout: int = 30):
        calls.append(command)
        if command[-1] == "--version":
            return subprocess.CompletedProcess(command, 0, "4.5.1\n", "")
        dest = Path(command[command.index("simplify") + 2]) if "simplify" in command else Path(command[-1])
        for name in ("simplify", "resize", "jpeg"):
            if name in command:
                dest = Path(command[command.index(name) + 2])
                break
        shutil.copyfile(reduced, dest)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(model_profile, "_run", fake_run)
    result = export_display_glb(
        source_path=source,
        display_path=display,
        record_path=record,
        transform_cli=cli,
        expected_version="4.5.1",
        method=_method(),
        orientation=_orientation(),
        note="保留原件；仅减面与压缩贴图。",
    )

    assert source.read_bytes() == before
    assert display.is_file()
    assert result["source_triangle_count"] == 40
    assert result["display_triangle_count"] == 12
    assert result["tool_version"] == "4.5.1"
    assert calls[0][:2] == ["node", str(cli.resolve())]
    assert any("simplify" in command for command in calls)
    saved = json.loads(record.read_text(encoding="utf-8"))
    assert saved["display_sha256"] == result["display_sha256"]
    assert str(source) not in record.read_text(encoding="utf-8")


def test_draco_source_is_rejected_without_local_decoder(tmp_path: Path) -> None:
    source = tmp_path / "source.glb"
    _glb(source)
    raw = source.read_bytes()
    json_length = int.from_bytes(raw[12:16], "little")
    data = json.loads(raw[20 : 20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
    data["extensionsUsed"] = ["KHR_draco_mesh_compression"]
    payload = json.dumps(data, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((-len(payload)) % 4)
    blob = raw[20 + json_length :]
    source.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 20 + len(payload) + len(blob))
        + struct.pack("<I4s", len(payload), b"JSON")
        + payload
        + blob
    )
    cli = tmp_path / "cli.js"
    cli.write_text("", encoding="utf-8")

    with pytest.raises(ModelProfileError, match="Draco"):
        export_display_glb(
            source_path=source,
            display_path=tmp_path / "display.glb",
            record_path=tmp_path / "record.json",
            transform_cli=cli,
            expected_version="4.5.1",
            method=_method(),
            orientation=_orientation(),
            note="测试",
        )
