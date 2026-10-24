from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from content_pipeline.assets.model_preview import render_preview
from content_pipeline.assets.model_profile import (
    DEFAULT_TRANSFORM_VERSION,
    ModelProfileError,
    export_display_glb,
    record_source_profile,
)
from content_pipeline.assets.preview_manifest import (
    PreviewInputError,
    record_preview,
    record_preview_batch,
)
from content_pipeline.assets.stage_assets import AssetStageError, stage_assets
from content_pipeline.build.compiler import compile_pack, write_documents
from content_pipeline.build.pack_writer import write_immutable_pack
from content_pipeline.build.rehearsal_pack import RehearsalPackError, build_rehearsal_pack
from content_pipeline.importers.story_assets import (
    StoryAssetImportError,
    import_story_asset_candidate,
)


def cmd_validate(pack: Path, dependency_packs: list[Path] | None = None) -> int:
    if not pack.is_dir():
        print(f"内容包目录不存在：{pack}", file=sys.stderr)
        return 2
    issues, _documents = compile_pack(pack, dependency_packs)
    if issues:
        for issue in issues:
            print(issue, file=sys.stderr)
        print(f"校验失败：{len(issues)} 项", file=sys.stderr)
        return 1
    print(f"源稿校验通过：{pack}")
    return 0


def cmd_build(pack: Path, out: Path, dependency_packs: list[Path] | None = None) -> int:
    if not pack.is_dir():
        print(f"内容包目录不存在：{pack}", file=sys.stderr)
        return 2
    issues, documents = compile_pack(pack, dependency_packs)
    if issues or documents is None:
        for issue in issues:
            print(issue, file=sys.stderr)
        print(f"编译失败：{len(issues)} 项", file=sys.stderr)
        return 1
    write_documents(out, documents)
    print(f"已编译候选包：{out}")
    return 0


def cmd_stage(
    pack: Path, out: Path, dependency_packs: list[Path] | None = None
) -> int:
    if not pack.is_dir():
        print(f"内容包目录不存在：{pack}", file=sys.stderr)
        return 2
    issues, documents = compile_pack(pack, dependency_packs)
    if issues or documents is None:
        for issue in issues:
            print(issue, file=sys.stderr)
        print(f"写入失败：{len(issues)} 项", file=sys.stderr)
        return 1
    write_issues, dest = write_immutable_pack(out, documents, dependency_packs)
    if write_issues or dest is None:
        for issue in write_issues:
            print(issue, file=sys.stderr)
        print(f"写入失败：{len(write_issues)} 项", file=sys.stderr)
        return 1
    print(f"已写入不可变版本目录：{dest}")
    return 0


def cmd_record_preview(
    *,
    asset_id: str,
    preview_asset_id: str,
    model: Path,
    preview: Path,
    manifest: Path,
    renderer: str,
    renderer_version: str,
    attribution: str,
    framing_file: Path,
) -> int:
    try:
        framing = json.loads(framing_file.read_text(encoding="utf-8"))
        changed = record_preview(
            manifest_path=manifest,
            asset_id=asset_id,
            preview_asset_id=preview_asset_id,
            model_path=model,
            preview_path=preview,
            renderer=renderer,
            renderer_version=renderer_version,
            attribution=attribution,
            framing=framing,
        )
    except (OSError, json.JSONDecodeError, PreviewInputError) as exc:
        print(f"预览登记失败：{exc}", file=sys.stderr)
        return 1
    if changed:
        print(f"已登记真实模型预览：{asset_id} → {manifest}")
    else:
        print(f"预览输入未变化，复用已有清单记录：{asset_id}")
    return 0


def cmd_render_preview(
    *,
    renderer_path: Path,
    expected_version: str,
    asset_id: str,
    preview_asset_id: str,
    model: Path,
    preview: Path,
    manifest: Path,
    attribution: str,
    framing_file: Path,
) -> int:
    try:
        framing = json.loads(framing_file.read_text(encoding="utf-8"))
        changed = render_preview(
            renderer_path=renderer_path,
            expected_version=expected_version,
            model_path=model,
            preview_path=preview,
            manifest_path=manifest,
            asset_id=asset_id,
            preview_asset_id=preview_asset_id,
            attribution=attribution,
            framing=framing,
        )
    except (OSError, json.JSONDecodeError, PreviewInputError) as exc:
        print(f"预览渲染失败：{exc}", file=sys.stderr)
        return 1
    print(
        f"已渲染并登记模型预览：{asset_id} → {manifest}"
        if changed
        else f"预览未变化，复用已有清单记录：{asset_id}"
    )
    return 0


def cmd_record_source_profile(
    *,
    model: Path,
    record: Path,
) -> int:
    try:
        record_source_profile(
            model_path=model,
            record_path=record,
        )
    except ModelProfileError as exc:
        print(f"源模型测量记录失败：{exc}", file=sys.stderr)
        return 1
    print(f"已记录源模型测量：{model.name} → {record}")
    return 0


def cmd_export_display_glb(
    *,
    source: Path,
    display: Path,
    record: Path,
    transform_cli: Path,
    expected_version: str,
    method: Path,
    orientation: Path,
    note: str,
    source_sha256: str | None = None,
) -> int:
    try:
        method_dict = json.loads(method.read_text(encoding="utf-8"))
        orientation_dict = json.loads(orientation.read_text(encoding="utf-8"))
        result = export_display_glb(
            source_path=source,
            display_path=display,
            record_path=record,
            transform_cli=transform_cli,
            expected_version=expected_version,
            method=method_dict,
            orientation=orientation_dict,
            note=note,
            source_sha256=source_sha256,
        )
    except (OSError, json.JSONDecodeError, ModelProfileError) as exc:
        print(f"展示版导出失败：{exc}", file=sys.stderr)
        return 1
    print(
        f"已导出展示版模型：{source.name} → {display} "
        f"({result['display_byte_size']}字节，{result['display_triangle_count']}三角)"
    )
    return 0


def cmd_batch_record_preview(*, batch: Path, manifest: Path) -> int:
    try:
        document = json.loads(batch.read_text(encoding="utf-8"))
        if not isinstance(document, dict) or document.get("schema_version") != 1:
            raise PreviewInputError("批量输入必须是schema_version为1的JSON对象")
        entries = document.get("previews")
        if not isinstance(entries, list) or not all(isinstance(item, dict) for item in entries):
            raise PreviewInputError("批量输入的previews必须是对象数组")
        items = []
        for entry in entries:
            item = dict(entry)
            for key in ("model_path", "preview_path"):
                path = Path(item[key])
                item[key] = (batch.parent / path).resolve() if not path.is_absolute() else path
            items.append(item)
        changed = record_preview_batch(manifest_path=manifest, items=items)
    except (OSError, json.JSONDecodeError, TypeError, KeyError, PreviewInputError) as exc:
        print(f"批量预览登记失败：{exc}", file=sys.stderr)
        return 1
    print(f"批量预览登记完成：{changed}项更新 → {manifest}")
    return 0


def cmd_rehearsal_pack(
    *,
    pack: Path,
    sources: Path,
    content_root: Path,
    asset_root: Path,
    version: str,
) -> int:
    try:
        result = build_rehearsal_pack(
            pack_dir=pack,
            sources_path=sources,
            content_root=content_root,
            asset_root=asset_root,
            version=version,
        )
    except (RehearsalPackError, AssetStageError) as exc:
        print(f"联调包生成失败：{exc}", file=sys.stderr)
        return 1
    print(
        f"已写入本机联调包：{result['pack_id']}@{result['runtime_version']} "
        f"内容={result['pack_dir']} 资源={result['asset_dir']}"
    )
    print(
        "作者稿未覆盖："
        f"{result['author_manifest']} 仍为 {result['author_version']} "
        f"{result['author_publication_status']}"
    )
    return 0


def cmd_stage_assets(
    *, pack: Path, sources: Path, out: Path, require_all: bool
) -> int:
    try:
        dest = stage_assets(
            pack_dir=pack, sources_path=sources, out_root=out, require_all=require_all
        )
    except AssetStageError as exc:
        print(f"资源暂存失败：{exc}", file=sys.stderr)
        return 1
    print(f"已写入版本化资源根：{dest}")
    return 0


def cmd_import_story_asset_candidate(
    *,
    source_root: Path,
    pack: Path,
    out: Path,
    binding_key: str,
    story_id: str,
    node_ids: list[str],
) -> int:
    try:
        candidate = import_story_asset_candidate(
            source_root=source_root,
            pack_dir=pack,
            output_file=out,
            binding_key=binding_key,
            story_id=story_id,
            node_ids=node_ids,
        )
    except StoryAssetImportError as exc:
        print(f"故事素材候选导入失败：{exc}", file=sys.stderr)
        return 1
    print(f"已写入未发布的故事素材候选清单：{out}")
    print(f"故事：{candidate['story_id']}；素材：{candidate['assets'][0]['id']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="内容制作命令")
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate", help="按公共 Schema 和包内引用校验作者源稿")
    validate.add_argument("--pack", required=True, type=Path, help="作者包目录")
    validate.add_argument("--dependency-pack", action="append", default=[], type=Path, help="一个可用的精确版本依赖包；可重复")
    build = sub.add_parser("build", help="编译作者源稿为运行时 JSON")
    build.add_argument("--pack", required=True, type=Path, help="作者包目录")
    build.add_argument("--dependency-pack", action="append", default=[], type=Path, help="一个可用的精确版本依赖包；可重复")
    build.add_argument("--out", required=True, type=Path, help="候选 JSON 输出目录")
    stage = sub.add_parser("stage", help="写入不可变版本目录，不覆盖已有版本")
    stage.add_argument("--pack", required=True, type=Path, help="作者包目录")
    stage.add_argument("--dependency-pack", action="append", default=[], type=Path, help="一个可用的精确版本依赖包；可重复")
    stage.add_argument("--out", required=True, type=Path, help="版本化内容根目录")
    preview = sub.add_parser(
        "record-preview",
        help="登记用真实GLB人工或离线渲染的PNG预览；不会调用生图服务",
    )
    preview.add_argument("--asset-id", required=True, help="契约中的稳定模型资源ID")
    preview.add_argument("--preview-asset-id", required=True, help="预览PNG对应的稳定资源ID")
    preview.add_argument("--model", required=True, type=Path, help="真实GLB源文件")
    preview.add_argument("--preview", required=True, type=Path, help="人工或离线导出的PNG")
    preview.add_argument("--manifest", required=True, type=Path, help="版本外部的预览导出清单")
    preview.add_argument("--renderer", required=True, help="例如 Blender 或其他离线渲染器")
    preview.add_argument("--renderer-version", required=True, help="固定且可复现的渲染器版本")
    preview.add_argument("--attribution", required=True, help="模型与衍生预览的署名/许可说明")
    preview.add_argument(
        "--framing", required=True, type=Path, help="相机、目标、尺寸与透明背景JSON"
    )
    render = sub.add_parser("render-preview", help="用固定版本Blender离线渲染GLB预览")
    render.add_argument("--renderer-path", required=True, type=Path, help="Blender可执行文件路径")
    render.add_argument("--expected-version", required=True, help="要求完全匹配的Blender版本")
    render.add_argument("--asset-id", required=True, help="契约中的稳定模型资源ID")
    render.add_argument("--preview-asset-id", required=True, help="预览PNG对应的稳定资源ID")
    render.add_argument("--model", required=True, type=Path, help="真实GLB源文件")
    render.add_argument("--preview", required=True, type=Path, help="预览PNG输出路径")
    render.add_argument("--manifest", required=True, type=Path, help="版本外部的预览导出清单")
    render.add_argument("--attribution", required=True, help="模型与衍生预览的署名/许可说明")
    render.add_argument(
        "--framing", required=True, type=Path, help="相机、环境、尺寸与透明背景JSON"
    )
    record_source = sub.add_parser("record-source-profile", help="记录真实GLB的完整测量快照")
    record_source.add_argument("--model", required=True, type=Path, help="真实GLB源文件")
    record_source.add_argument("--record", required=True, type=Path, help="输出JSON测量快照路径")
    export_display = sub.add_parser("export-display-glb", help="用gltf-transform减面并导出展示版GLB")
    export_display.add_argument("--source", required=True, type=Path, help="真实GLB源文件")
    export_display.add_argument("--display", required=True, type=Path, help="输出展示版GLB路径")
    export_display.add_argument("--record", required=True, type=Path, help="输出JSON测量快照路径")
    export_display.add_argument(
        "--transform-cli",
        required=True,
        type=Path,
        help="gltf-transform可执行文件路径；本机版本须与--expected-version一致",
    )
    export_display.add_argument(
        "--expected-version",
        default=DEFAULT_TRANSFORM_VERSION,
        help="要求完全匹配的gltf-transform版本",
    )
    export_display.add_argument("--method", required=True, type=Path, help="减面方法JSON路径")
    export_display.add_argument("--orientation", required=True, type=Path, help="默认朝向JSON路径")
    export_display.add_argument("--note", required=True, help="来源记录说明")
    export_display.add_argument("--source-sha256", help="可选：登记的源GLB哈希，防止覆盖")
    batch = sub.add_parser("batch-record-preview", help="按输入清单校验并批量登记人工导出的PNG")
    batch.add_argument(
        "--batch", required=True, type=Path, help="预览项目清单；相对素材路径以此文件目录为准"
    )
    batch.add_argument("--manifest", required=True, type=Path, help="版本外部的预览导出清单")
    stage_local = sub.add_parser(
        "stage-assets", help="按内容包清单把本机真实PNG/GLB复制到版本化资源根"
    )
    stage_local.add_argument("--pack", required=True, type=Path, help="作者包目录")
    stage_local.add_argument(
        "--sources", required=True, type=Path, help="忽略目录中的本机来源映射JSON"
    )
    stage_local.add_argument("--out", required=True, type=Path, help="版本化资源根目录")
    stage_local.add_argument(
        "--require-all",
        action="store_true",
        help="内容包中每个资产都必须有本机源文件，缺文件则失败",
    )
    rehearsal = sub.add_parser(
        "rehearsal-pack",
        help="生成仅本机联调用的不可变published副本，不覆盖作者draft",
    )
    rehearsal.add_argument("--pack", required=True, type=Path, help="作者包目录")
    rehearsal.add_argument(
        "--sources", required=True, type=Path, help="忽略目录中的本机来源映射JSON"
    )
    rehearsal.add_argument("--content-root", required=True, type=Path, help="版本化内容根目录")
    rehearsal.add_argument("--asset-root", required=True, type=Path, help="版本化资源根目录")
    rehearsal.add_argument("--version", required=True, help="联调published版本，必须是新的semver")
    story_assets = sub.add_parser(
        "import-story-asset-candidate",
        help="校验本机已选场景图并生成待审核清单，不发布到运行时内容包",
    )
    story_assets.add_argument("--source-root", required=True, type=Path, help="本机生成素材批次目录")
    story_assets.add_argument("--pack", required=True, type=Path, help="目标作者内容包目录")
    story_assets.add_argument("--binding-key", required=True, help="scene-bindings中的素材选择键")
    story_assets.add_argument("--story-id", required=True, help="目标故事稳定ID")
    story_assets.add_argument("--node-id", required=True, action="append", help="目标故事节点ID，可重复")
    story_assets.add_argument("--out", required=True, type=Path, help="未发布候选清单输出路径")
    args = parser.parse_args(argv)
    if args.command == "validate":
        return cmd_validate(args.pack, args.dependency_pack)
    if args.command == "build":
        return cmd_build(args.pack, args.out, args.dependency_pack)
    if args.command == "stage":
        return cmd_stage(args.pack, args.out, args.dependency_pack)
    if args.command == "record-preview":
        return cmd_record_preview(
            asset_id=args.asset_id,
            preview_asset_id=args.preview_asset_id,
            model=args.model,
            preview=args.preview,
            manifest=args.manifest,
            renderer=args.renderer,
            renderer_version=args.renderer_version,
            attribution=args.attribution,
            framing_file=args.framing,
        )
    if args.command == "record-source-profile":
        return cmd_record_source_profile(
            model=args.model,
            record=args.record,
        )
    if args.command == "export-display-glb":
        return cmd_export_display_glb(
            source=args.source,
            display=args.display,
            record=args.record,
            transform_cli=args.transform_cli,
            expected_version=args.expected_version,
            method=args.method,
            orientation=args.orientation,
            note=args.note,
            source_sha256=args.source_sha256,
        )
    if args.command == "render-preview":
        return cmd_render_preview(
            renderer_path=args.renderer_path,
            expected_version=args.expected_version,
            asset_id=args.asset_id,
            preview_asset_id=args.preview_asset_id,
            model=args.model,
            preview=args.preview,
            manifest=args.manifest,
            attribution=args.attribution,
            framing_file=args.framing,
        )
    if args.command == "batch-record-preview":
        return cmd_batch_record_preview(batch=args.batch, manifest=args.manifest)
    if args.command == "stage-assets":
        return cmd_stage_assets(
            pack=args.pack,
            sources=args.sources,
            out=args.out,
            require_all=args.require_all,
        )
    if args.command == "rehearsal-pack":
        return cmd_rehearsal_pack(
            pack=args.pack,
            sources=args.sources,
            content_root=args.content_root,
            asset_root=args.asset_root,
            version=args.version,
        )
    if args.command == "import-story-asset-candidate":
        return cmd_import_story_asset_candidate(
            source_root=args.source_root,
            pack=args.pack,
            out=args.out,
            binding_key=args.binding_key,
            story_id=args.story_id,
            node_ids=args.node_id,
        )
    parser.error("未知命令")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
