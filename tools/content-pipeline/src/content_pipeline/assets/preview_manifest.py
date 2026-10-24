from __future__ import annotations

import json
import math
import os
import struct
import tempfile
import zlib
from pathlib import Path
from typing import Any

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class PreviewInputError(ValueError):
    """Raised when a model preview or its provenance is invalid."""


def sha256_file(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def glb_version(path: Path) -> int:
    size = path.stat().st_size
    with path.open("rb") as source:
        header = source.read(12)
        if len(header) != 12:
            raise PreviewInputError(f"GLB文件头不完整：{path.name}")
        magic, version, declared_size = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or declared_size != size:
            raise PreviewInputError(f"不是完整的glTF 2.0 GLB文件：{path.name}")
        if size < 20:
            raise PreviewInputError(f"GLB缺少JSON内容块：{path.name}")
        chunk_header = source.read(8)
        chunk_length, chunk_type = struct.unpack("<I4s", chunk_header)
        if chunk_type != b"JSON" or chunk_length % 4 or chunk_length > size - 20:
            raise PreviewInputError(f"GLB首块必须是完整的JSON内容块：{path.name}")
        try:
            document = json.loads(source.read(chunk_length).decode("utf-8").rstrip(" \t\r\n\0"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PreviewInputError(f"GLB JSON内容无效：{path.name}") from exc
        if (
            not isinstance(document, dict)
            or not isinstance(document.get("asset"), dict)
            or document["asset"].get("version") != "2.0"
        ):
            raise PreviewInputError(f"GLB JSON未声明glTF 2.0：{path.name}")
        offset = 20 + chunk_length
        while offset < size:
            source.seek(offset)
            next_header = source.read(8)
            if len(next_header) != 8:
                raise PreviewInputError(f"GLB包含不完整的数据块：{path.name}")
            next_length, _ = struct.unpack("<I4s", next_header)
            if next_length % 4 or next_length > size - offset - 8:
                raise PreviewInputError(f"GLB数据块长度无效：{path.name}")
            offset += 8 + next_length
        if offset != size:
            raise PreviewInputError(f"GLB数据块超出文件范围：{path.name}")
    return version


def _png_info(path: Path) -> tuple[int, int, int]:
    """Validate PNG chunk framing and return width, height, and color type."""
    with path.open("rb") as source:
        if source.read(8) != _PNG_SIGNATURE:
            raise PreviewInputError(f"预览必须是PNG图像：{path.name}")
        width = height = color_type = 0
        has_idat = False
        has_iend = False
        idat = bytearray()
        first = True
        while not has_iend:
            header = source.read(8)
            if len(header) != 8:
                raise PreviewInputError(f"PNG缺少完整结束块：{path.name}")
            length, chunk_type = struct.unpack(">I4s", header)
            if length > 128 * 1024 * 1024:
                raise PreviewInputError(f"PNG块过大：{path.name}")
            data = source.read(length)
            crc_bytes = source.read(4)
            if len(data) != length or len(crc_bytes) != 4:
                raise PreviewInputError(f"PNG块被截断：{path.name}")
            expected_crc = struct.unpack(">I", crc_bytes)[0]
            if zlib.crc32(chunk_type + data) & 0xFFFFFFFF != expected_crc:
                raise PreviewInputError(f"PNG块校验失败：{path.name}")
            if first:
                if chunk_type != b"IHDR" or length != 13:
                    raise PreviewInputError(f"PNG缺少合法IHDR：{path.name}")
                width, height = struct.unpack(">II", data[:8])
                bit_depth = data[8]
                color_type = data[9]
                if (
                    not width
                    or not height
                    or width > 4096
                    or height > 4096
                    or bit_depth != 8
                    or color_type not in {2, 6}
                    or data[10:13] != b"\0\0\0"
                ):
                    raise PreviewInputError(
                        f"PNG仅支持4096以内的8位RGB/RGBA非隔行图像：{path.name}"
                    )
                first = False
            elif chunk_type == b"IHDR":
                raise PreviewInputError(f"PNG包含重复IHDR：{path.name}")
            if chunk_type == b"IDAT":
                has_idat = True
                if len(idat) + length > 128 * 1024 * 1024:
                    raise PreviewInputError(f"PNG压缩数据过大：{path.name}")
                idat.extend(data)
            if chunk_type == b"IEND":
                if length != 0:
                    raise PreviewInputError(f"PNG结束块无效：{path.name}")
                has_iend = True
        if not width or not height or not has_idat or source.read(1):
            raise PreviewInputError(f"PNG缺少图像数据、尺寸或包含多余内容：{path.name}")
        channels = 4 if color_type == 6 else 3
        row_size = width * channels + 1
        expected_size = row_size * height
        try:
            decoder = zlib.decompressobj()
            pixels = decoder.decompress(idat, expected_size + 1)
        except zlib.error as exc:
            raise PreviewInputError(f"PNG图像数据无法解压：{path.name}") from exc
        if (
            len(pixels) != expected_size
            or not decoder.eof
            or decoder.unconsumed_tail
            or decoder.unused_data
            or any(pixels[offset] > 4 for offset in range(0, expected_size, row_size))
        ):
            raise PreviewInputError(f"PNG像素数据不完整或扫描行无效：{path.name}")
        return width, height, color_type


def png_dimensions(path: Path) -> tuple[int, int]:
    width, height, _ = _png_info(path)
    return width, height


def validate_framing(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PreviewInputError("取景参数必须是JSON对象")
    camera = value.get("camera_location")
    target = value.get("target")
    if not _vector(camera) or not _vector(target) or camera == target:
        raise PreviewInputError("取景参数需包含不同的camera_location和target三维坐标")
    scale = value.get("orthographic_scale")
    if (
        not isinstance(scale, (int, float))
        or isinstance(scale, bool)
        or not math.isfinite(scale)
        or scale <= 0
    ):
        raise PreviewInputError("orthographic_scale必须是正数")
    resolution = value.get("resolution")
    if (
        not isinstance(resolution, list)
        or len(resolution) != 2
        or any(type(item) is not int or item < 64 or item > 4096 for item in resolution)
    ):
        raise PreviewInputError("resolution宽高须为64至4096之间的整数")
    if type(value.get("transparent_background")) is not bool:
        raise PreviewInputError("transparent_background必须明确为布尔值")
    environment = value.get("environment")
    if (
        not isinstance(environment, dict)
        or environment.get("preset") != "museum-neutral-v1"
        or environment.get("color_management") not in {"Standard", "AgX"}
    ):
        raise PreviewInputError("environment须固定preset与color_management")
    return {
        "camera_location": [float(item) for item in camera],
        "target": [float(item) for item in target],
        "orthographic_scale": float(scale),
        "resolution": resolution,
        "transparent_background": value["transparent_background"],
        "environment": {
            "preset": environment["preset"],
            "color_management": environment["color_management"],
        },
    }


def record_preview(
    *,
    manifest_path: Path,
    asset_id: str,
    preview_asset_id: str,
    model_path: Path,
    preview_path: Path,
    renderer: str,
    renderer_version: str,
    attribution: str,
    framing: Any,
) -> bool:
    """Register a manually or automatically rendered preview after validating both files.

    Returns ``True`` when the manifest changed and ``False`` when an identical
    record already exists. Local paths are intentionally excluded from records.
    """
    text_fields = (asset_id, preview_asset_id, renderer, renderer_version, attribution)
    if not all(isinstance(value, str) and value.strip() for value in text_fields):
        raise PreviewInputError("asset_id、渲染器、版本和署名均为必填项")
    asset_id = asset_id.strip()
    preview_asset_id = preview_asset_id.strip()
    if not model_path.is_file() or not preview_path.is_file():
        raise PreviewInputError("模型GLB和预览PNG都必须存在")
    glb_version(model_path)
    width, height, color_type = _png_info(preview_path)
    normalized_framing = validate_framing(framing)
    if [width, height] != normalized_framing["resolution"]:
        raise PreviewInputError("PNG尺寸必须与固定取景参数中的resolution一致")
    if normalized_framing["transparent_background"] and color_type != 6:
        raise PreviewInputError("透明背景预览必须使用RGBA PNG")
    record = {
        "asset_id": asset_id,
        "preview_asset_id": preview_asset_id,
        "model_sha256": sha256_file(model_path),
        "preview_sha256": sha256_file(preview_path),
        "format": "png",
        "dimensions": [width, height],
        "renderer": renderer.strip(),
        "renderer_version": renderer_version.strip(),
        "attribution": attribution.strip(),
        "framing": normalized_framing,
    }

    manifest: dict[str, Any] = {"schema_version": 1, "previews": []}
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise PreviewInputError(f"无法读取预览清单：{exc}") from exc
        if (
            not isinstance(existing, dict)
            or existing.get("schema_version") != 1
            or not isinstance(existing.get("previews"), list)
        ):
            raise PreviewInputError("预览清单结构不合法或版本不支持")
        manifest = existing
    records = manifest["previews"]
    matching_index: int | None = None
    for index, item in enumerate(records):
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("asset_id"), str)
            or not isinstance(item.get("preview_asset_id"), str)
        ):
            raise PreviewInputError("预览清单包含无效记录")
        if item["asset_id"] == asset_id:
            if matching_index is not None:
                raise PreviewInputError(f"预览清单重复登记文物资源：{asset_id}")
            matching_index = index
        elif item["preview_asset_id"] == preview_asset_id:
            raise PreviewInputError(f"预览资源ID已绑定到其他文物：{preview_asset_id}")
    if matching_index is None:
        records.append(record)
    else:
        if records[matching_index] == record:
            return False
        records[matching_index] = record
    records.sort(key=lambda item: item["asset_id"])
    _write_json_atomically(manifest_path, manifest)
    return True


def record_preview_batch(*, manifest_path: Path, items: list[dict[str, Any]]) -> int:
    """Validate and record a batch atomically, returning the number of changed assets."""
    if not items:
        raise PreviewInputError("批量预览清单至少需要一项")
    asset_ids: set[str] = set()
    preview_ids: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise PreviewInputError("批量项目必须是JSON对象")
        asset_id = item.get("asset_id")
        preview_id = item.get("preview_asset_id")
        if not isinstance(asset_id, str) or not isinstance(preview_id, str):
            raise PreviewInputError("批量项目必须提供asset_id和preview_asset_id")
        asset_id = asset_id.strip()
        preview_id = preview_id.strip()
        if asset_id in asset_ids or preview_id in preview_ids:
            raise PreviewInputError("批量清单不得重复登记文物资源或预览资源ID")
        asset_ids.add(asset_id)
        preview_ids.add(preview_id)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=".preview-batch-", dir=manifest_path.parent)
    temporary_manifest = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as output:
            if manifest_path.exists():
                output.write(manifest_path.read_bytes())
            else:
                output.write(b'{"schema_version":1,"previews":[]}\n')
            output.flush()
            os.fsync(output.fileno())
        changed = 0
        for item in items:
            if "manifest_path" in item:
                raise PreviewInputError("批量项目不得指定输出manifest")
            changed += record_preview(manifest_path=temporary_manifest, **item)
        if changed:
            os.replace(temporary_manifest, manifest_path)
        return changed
    except OSError as exc:
        raise PreviewInputError(f"无法写入批量预览清单：{exc}") from exc
    finally:
        if temporary_manifest.exists():
            temporary_manifest.unlink()


def _vector(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 3
        and all(
            isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item)
            for item in value
        )
    )


def _write_json_atomically(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, delete=False
        ) as output:
            temporary = output.name
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
