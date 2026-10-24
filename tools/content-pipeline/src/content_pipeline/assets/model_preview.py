from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from content_pipeline.assets.preview_manifest import (
    PreviewInputError,
    glb_version,
    record_preview,
    validate_framing,
)

_RENDER_SCRIPT = r"""import bpy
import json
import sys
from mathutils import Vector

arguments = sys.argv[sys.argv.index("--") + 1:]
model_path, output_path, framing_path = arguments
with open(framing_path, encoding="utf-8") as source:
    framing = json.load(source)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=model_path)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x, scene.render.resolution_y = framing["resolution"]
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA" if framing["transparent_background"] else "RGB"
scene.render.film_transparent = framing["transparent_background"]
scene.render.filepath = output_path
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = framing["environment"]["color_management"]
scene.render.resolution_percentage = 100

world = bpy.data.worlds.new("Museum neutral")
scene.world = world
world.use_nodes = True
background = world.node_tree.nodes.get("Background")
background.inputs["Color"].default_value = (0.16, 0.17, 0.19, 1.0)
background.inputs["Strength"].default_value = 0.0 if framing["transparent_background"] else 0.35

target = Vector(framing["target"])
camera_position = Vector(framing["camera_location"])
camera_data = bpy.data.cameras.new("Museum preview camera")
camera = bpy.data.objects.new("Museum preview camera", camera_data)
scene.collection.objects.link(camera)
camera.location = camera_position
camera.rotation_euler = (target - camera_position).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = framing["orthographic_scale"]
scene.camera = camera

view = (camera_position - target).normalized()
right = view.cross(Vector((0.0, 0.0, 1.0))).normalized()
up = right.cross(view).normalized()
def add_area(name, position, energy, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = position
    light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
add_area("Museum key", target + view * 4.0 - right * 3.0 + up * 4.0, 900.0, 5.0)
add_area("Museum fill", target + view * 3.0 + right * 4.0 + up * 1.0, 450.0, 5.0)
add_area("Museum rim", target - view * 2.0 + up * 3.0, 700.0, 3.0)

bpy.ops.render.render(write_still=True)
"""


def render_preview(
    *,
    renderer_path: Path,
    expected_version: str,
    model_path: Path,
    preview_path: Path,
    manifest_path: Path,
    asset_id: str,
    preview_asset_id: str,
    attribution: str,
    framing: Any,
) -> bool:
    framing = validate_framing(framing)
    if not all(
        isinstance(value, str) and value.strip()
        for value in (asset_id, preview_asset_id, attribution)
    ):
        raise PreviewInputError("asset_id、preview_asset_id和署名均为必填项")
    if not model_path.is_file():
        raise PreviewInputError(f"找不到真实模型GLB：{model_path.name}")
    glb_version(model_path)
    if not renderer_path.is_file():
        raise PreviewInputError("找不到Blender可执行文件；可改用 record-preview 登记人工导出的PNG")
    if not expected_version.strip():
        raise PreviewInputError("必须指定固定的Blender版本")
    version_result = _run([str(renderer_path), "--version"])
    if version_result.returncode != 0:
        raise PreviewInputError(f"无法读取Blender版本：{_short_output(version_result)}")
    match = re.search(r"^Blender\s+(\S+)", version_result.stdout, re.MULTILINE)
    if match is None or match.group(1) != expected_version:
        actual = match.group(1) if match else "未知"
        raise PreviewInputError(f"Blender版本不匹配：要求{expected_version}，实际{actual}")

    preview_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="museum-preview-") as temporary_directory:
        work = Path(temporary_directory)
        framing_path = work / "framing.json"
        script_path = work / "render_preview.py"
        temporary_preview = work / "preview.png"
        framing_path.write_text(json.dumps(framing, ensure_ascii=False), encoding="utf-8")
        script_path.write_text(_RENDER_SCRIPT, encoding="utf-8")
        result = _run(
            [
                str(renderer_path),
                "--background",
                "--factory-startup",
                "--python",
                str(script_path),
                "--",
                str(model_path.resolve()),
                str(temporary_preview),
                str(framing_path),
            ],
            timeout=600,
        )
        if result.returncode != 0 or not temporary_preview.is_file():
            raise PreviewInputError(f"Blender渲染失败，未生成预览PNG：{_short_output(result)}")
        # copyfile：临时目录常在系统盘，预览输出在资源盘；Windows 不能 os.replace 跨盘。
        shutil.copyfile(temporary_preview, preview_path)

    return record_preview(
        manifest_path=manifest_path,
        asset_id=asset_id,
        preview_asset_id=preview_asset_id,
        model_path=model_path,
        preview_path=preview_path,
        renderer="Blender",
        renderer_version=expected_version,
        attribution=attribution,
        framing=framing,
    )


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
        raise PreviewInputError(f"无法运行Blender：{exc}") from exc


def _short_output(result: subprocess.CompletedProcess[str]) -> str:
    output = (result.stderr or result.stdout).strip()
    return output[-1200:] or f"退出码{result.returncode}"
