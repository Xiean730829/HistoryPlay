from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from content_pipeline.assets.preview_manifest import (
    PreviewInputError,
    glb_version,
    sha256_file,
)

DEFAULT_TRANSFORM_VERSION = "4.5.1"


class ModelProfileError(ValueError):
    """Raised when a source GLB cannot be measured or reduced for display."""


def profile_glb(path: Path) -> dict[str, Any]:
    """Measure a complete glTF 2.0 GLB without mutating it."""
    if not path.is_file():
        raise ModelProfileError(f"找不到真实模型GLB：{path.name}")
    try:
        glb_version(path)
    except PreviewInputError as exc:
        raise ModelProfileError(str(exc)) from exc
    document, bin_blob = _read_glb(path)
    images = document.get("images") or []
    textures = document.get("textures") or []
    materials = document.get("materials") or []
    accessors = document.get("accessors") or []
    meshes = document.get("meshes") or []
    primitives = 0
    triangles = 0
    for mesh in meshes:
        if not isinstance(mesh, dict):
            continue
        for primitive in mesh.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            primitives += 1
            triangles += _primitive_triangles(primitive, accessors)
    extensions = document.get("extensionsUsed") or []
    images_info = [_image_info(image, bin_blob, document) for image in images if isinstance(image, dict)]
    return {
        "byte_size": path.stat().st_size,
        "sha256": sha256_file(path),
        "mesh_count": len(meshes),
        "primitive_count": primitives,
        "triangle_count": triangles,
        "image_count": len(images),
        "texture_count": len(textures),
        "material_count": len(materials),
        "images": images_info,
        "extensions_used": [item for item in extensions if isinstance(item, str)],
        "has_draco": "KHR_draco_mesh_compression" in extensions,
    }


def record_source_profile(*, model_path: Path, record_path: Path) -> dict[str, Any]:
    profile = profile_glb(model_path)
    record = {
        "schema_version": 1,
        "kind": "source",
        "model_sha256": profile["sha256"],
        "byte_size": profile["byte_size"],
        "mesh_count": profile["mesh_count"],
        "primitive_count": profile["primitive_count"],
        "triangle_count": profile["triangle_count"],
        "image_count": profile["image_count"],
        "texture_count": profile["texture_count"],
        "material_count": profile["material_count"],
        "images": profile["images"],
        "extensions_used": profile["extensions_used"],
        "has_draco": profile["has_draco"],
    }
    _write_json_atomically(record_path, record)
    return record


def export_display_glb(
    *,
    source_path: Path,
    display_path: Path,
    record_path: Path,
    transform_cli: Path,
    expected_version: str,
    method: dict[str, Any],
    orientation: dict[str, Any],
    note: str,
    source_sha256: str | None = None,
) -> dict[str, Any]:
    if not all(isinstance(value, str) and value.strip() for value in (expected_version, note)):
        raise ModelProfileError("工具版本和来源记录说明均为必填项")
    if not source_path.is_file():
        raise ModelProfileError(f"找不到真实模型GLB：{source_path.name}")
    source = profile_glb(source_path)
    if source_sha256 and source["sha256"] != source_sha256:
        raise ModelProfileError("源GLB哈希与登记值不一致，拒绝覆盖展示版")
    if source["has_draco"]:
        raise ModelProfileError("源模型含Draco压缩，须先用同版本解码器展开再减面")
    steps = _normalize_method(method)
    orientation = _normalize_orientation(orientation)
    _require_transform(transform_cli, expected_version)
    display_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="museum-display-") as temporary_directory:
        work = Path(temporary_directory)
        current = work / "input.glb"
        shutil.copyfile(source_path, current)
        for index, step in enumerate(steps):
            nxt = work / f"step-{index}.glb"
            _run_transform(transform_cli, step, current, nxt)
            current = nxt
        try:
            glb_version(current)
        except PreviewInputError as exc:
            raise ModelProfileError(str(exc)) from exc
        display = profile_glb(current)
        _copy_across_volumes(current, display_path)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    record = {
        "schema_version": 1,
        "kind": "display",
        "source_sha256": source["sha256"],
        "display_sha256": display["sha256"],
        "source_byte_size": source["byte_size"],
        "display_byte_size": display["byte_size"],
        "source_triangle_count": source["triangle_count"],
        "display_triangle_count": display["triangle_count"],
        "source_images": source["images"],
        "display_images": display["images"],
        "method": steps,
        "tool": "gltf-transform",
        "tool_version": expected_version,
        "orientation": orientation,
        "elapsed_ms": elapsed_ms,
        "note": note.strip(),
        "meets_5_to_10mb_target": display["byte_size"] <= 10 * 1024 * 1024,
    }
    _write_json_atomically(record_path, record)
    return record


def _cli_command(cli: Path) -> list[str]:
    resolved = cli.resolve()
    if resolved.suffix.lower() == ".js":
        return ["node", str(resolved)]
    return [str(resolved)]


def _require_transform(cli: Path, expected_version: str) -> None:
    if not cli.is_file():
        raise ModelProfileError("找不到gltf-transform可执行文件")
    result = _run([*_cli_command(cli), "--version"])
    if result.returncode != 0:
        raise ModelProfileError(f"无法读取gltf-transform版本：{_short_output(result)}")
    actual = (result.stdout or result.stderr).strip().splitlines()[0].strip()
    if actual != expected_version:
        raise ModelProfileError(f"gltf-transform版本不匹配：要求{expected_version}，实际{actual}")


def _run_transform(cli: Path, step: dict[str, Any], source: Path, dest: Path) -> None:
    command = [*_cli_command(cli), step["command"], str(source), str(dest)]
    for key, value in step["options"].items():
        flag = f"--{key.replace('_', '-')}"
        if isinstance(value, bool):
            command.extend([flag, "true" if value else "false"])
            continue
        command.extend([flag, str(value)])
    timeout = 1800 if step["command"] in {"simplify", "join"} else 300
    result = _run(command, timeout=timeout)
    if result.returncode != 0 or not dest.is_file():
        raise ModelProfileError(
            f"gltf-transform {step['command']} 失败：{_short_output(result)}"
        )


def _normalize_method(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise ModelProfileError("减面方法必须是schema_version为1的对象")
    raw_steps = value.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise ModelProfileError("减面方法必须提供非空steps")
    allowed = {"weld", "join", "simplify", "resize", "jpeg", "webp", "prune", "dedup"}
    steps: list[dict[str, Any]] = []
    for item in raw_steps:
        if not isinstance(item, dict) or not isinstance(item.get("command"), str):
            raise ModelProfileError("每个步骤必须包含command")
        command = item["command"].strip()
        if command not in allowed:
            raise ModelProfileError(f"不支持会改器物形状的步骤：{command}")
        options = item.get("options") or {}
        if not isinstance(options, dict):
            raise ModelProfileError(f"{command} 的options必须是对象")
        normalized: dict[str, int | float | bool | str] = {}
        for key, option in options.items():
            if not isinstance(key, str) or not key.strip():
                raise ModelProfileError(f"{command} 包含空选项名")
            if (
                type(option) is bool
                or type(option) is int
                or (type(option) is float and math.isfinite(option))
            ):
                normalized[key] = option
            elif isinstance(option, str) and option.strip():
                normalized[key] = option.strip()
            else:
                raise ModelProfileError(f"{command} 的选项 {key} 类型无效")
        if command == "simplify":
            ratio = normalized.get("ratio")
            if not isinstance(ratio, (int, float)) or not 0 < float(ratio) <= 1:
                raise ModelProfileError("simplify.ratio必须在(0,1]内，避免把器物减成空壳")
        if command == "resize":
            width = normalized.get("width")
            height = normalized.get("height")
            if not isinstance(width, int) or not isinstance(height, int) or width < 64 or height < 64:
                raise ModelProfileError("resize宽高须为不小于64的整数")
        steps.append({"command": command, "options": normalized})
    return steps


def _normalize_orientation(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ModelProfileError("默认朝向必须是对象")
    orbit = value.get("camera_orbit")
    note = value.get("orientation_note")
    if not isinstance(orbit, str) or not orbit.strip() or not isinstance(note, str) or not note.strip():
        raise ModelProfileError("默认朝向须提供camera_orbit和orientation_note")
    return {"camera_orbit": orbit.strip(), "orientation_note": note.strip()}


def _read_glb(path: Path) -> tuple[dict[str, Any], bytes]:
    data = path.read_bytes()
    json_length = int.from_bytes(data[12:16], "little")
    document = json.loads(data[20 : 20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
    if not isinstance(document, dict):
        raise ModelProfileError(f"GLB JSON不是对象：{path.name}")
    offset = 20 + json_length
    blob = b""
    if offset + 8 <= len(data):
        chunk_length = int.from_bytes(data[offset : offset + 4], "little")
        chunk_type = data[offset + 4 : offset + 8]
        if chunk_type == b"BIN\x00":
            start = offset + 8
            blob = data[start : start + chunk_length]
    return document, blob


def _primitive_triangles(primitive: dict[str, Any], accessors: list[Any]) -> int:
    indices = primitive.get("indices")
    mode = primitive.get("mode", 4)
    if mode not in {4, None}:
        return 0
    if isinstance(indices, int) and 0 <= indices < len(accessors):
        accessor = accessors[indices]
        if isinstance(accessor, dict) and isinstance(accessor.get("count"), int):
            return accessor["count"] // 3
        return 0
    attributes = primitive.get("attributes")
    if not isinstance(attributes, dict):
        return 0
    position = attributes.get("POSITION")
    if isinstance(position, int) and 0 <= position < len(accessors):
        accessor = accessors[position]
        if isinstance(accessor, dict) and isinstance(accessor.get("count"), int):
            return accessor["count"] // 3
    return 0


def _image_info(image: dict[str, Any], blob: bytes, document: dict[str, Any]) -> dict[str, Any]:
    mime = image.get("mimeType") if isinstance(image.get("mimeType"), str) else "unknown"
    buffer_views = document.get("bufferViews") or []
    view_index = image.get("bufferView")
    byte_size = 0
    if isinstance(view_index, int) and 0 <= view_index < len(buffer_views):
        view = buffer_views[view_index]
        if isinstance(view, dict) and isinstance(view.get("byteLength"), int):
            byte_size = view["byteLength"]
            start = int(view.get("byteOffset") or 0)
            payload = blob[start : start + byte_size]
            width, height = _image_size(payload, mime)
            return {
                "mime_type": mime,
                "byte_size": byte_size,
                "width": width,
                "height": height,
            }
    return {"mime_type": mime, "byte_size": byte_size, "width": None, "height": None}


def _image_size(payload: bytes, mime: str) -> tuple[int | None, int | None]:
    if mime == "image/png" and len(payload) >= 24 and payload[:8] == b"\x89PNG\r\n\x1a\n":
        width = int.from_bytes(payload[16:20], "big")
        height = int.from_bytes(payload[20:24], "big")
        return width, height
    if mime in {"image/jpeg", "image/jpg"} and payload[:2] == b"\xff\xd8":
        index = 2
        while index + 9 < len(payload):
            if payload[index] != 0xFF:
                break
            marker = payload[index + 1]
            if marker in {0xC0, 0xC1, 0xC2}:
                height = int.from_bytes(payload[index + 5 : index + 7], "big")
                width = int.from_bytes(payload[index + 7 : index + 9], "big")
                return width, height
            if marker in {0xD8, 0xD9}:
                index += 2
                continue
            length = int.from_bytes(payload[index + 2 : index + 4], "big")
            index += 2 + length
    return None, None


def _copy_across_volumes(source: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, dir=dest.parent) as handle:
        temporary = Path(handle.name)
    try:
        shutil.copyfile(source, temporary)
        try:
            os.replace(temporary, dest)
        except OSError:
            shutil.copyfile(temporary, dest)
            temporary.unlink(missing_ok=True)
    finally:
        if temporary.exists():
            temporary.unlink()


def _write_json_atomically(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
            temporary = output.name
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.replace(temporary, path)
            temporary = None
        except OSError:
            shutil.copyfile(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def _run(command: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ModelProfileError(f"无法运行gltf-transform：{exc}") from exc


def _short_output(result: subprocess.CompletedProcess[str]) -> str:
    output = (result.stderr or result.stdout).strip()
    return output[-1200:] or f"退出码{result.returncode}"
