from __future__ import annotations

import argparse
import sys
from pathlib import Path

from content_pipeline.build.compiler import compile_pack, write_documents
from content_pipeline.build.pack_writer import write_immutable_pack
from content_pipeline.validation.reference_validator import validate_references
from content_pipeline.validation.schema_validator import validate_pack


def cmd_validate(pack: Path) -> int:
    if not pack.is_dir():
        print(f"内容包目录不存在：{pack}", file=sys.stderr)
        return 2
    issues = validate_pack(pack)
    issues.extend(validate_references(pack))
    if issues:
        for issue in issues:
            print(issue, file=sys.stderr)
        print(f"校验失败：{len(issues)} 项", file=sys.stderr)
        return 1
    print(f"源稿校验通过：{pack}")
    return 0


def cmd_build(pack: Path, out: Path) -> int:
    if not pack.is_dir():
        print(f"内容包目录不存在：{pack}", file=sys.stderr)
        return 2
    issues, documents = compile_pack(pack)
    if issues or documents is None:
        for issue in issues:
            print(issue, file=sys.stderr)
        print(f"编译失败：{len(issues)} 项", file=sys.stderr)
        return 1
    write_documents(out, documents)
    print(f"已编译候选包：{out}")
    return 0


def cmd_stage(pack: Path, out: Path) -> int:
    if not pack.is_dir():
        print(f"内容包目录不存在：{pack}", file=sys.stderr)
        return 2
    issues, documents = compile_pack(pack)
    if issues or documents is None:
        for issue in issues:
            print(issue, file=sys.stderr)
        print(f"写入失败：{len(issues)} 项", file=sys.stderr)
        return 1
    write_issues, dest = write_immutable_pack(out, documents)
    if write_issues or dest is None:
        for issue in write_issues:
            print(issue, file=sys.stderr)
        print(f"写入失败：{len(write_issues)} 项", file=sys.stderr)
        return 1
    print(f"已写入不可变版本目录：{dest}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="内容制作命令")
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate", help="按公共 Schema 和包内引用校验作者源稿")
    validate.add_argument("--pack", required=True, type=Path, help="作者包目录")
    build = sub.add_parser("build", help="编译作者源稿为运行时 JSON")
    build.add_argument("--pack", required=True, type=Path, help="作者包目录")
    build.add_argument("--out", required=True, type=Path, help="候选 JSON 输出目录")
    stage = sub.add_parser("stage", help="写入不可变版本目录，不覆盖已有版本")
    stage.add_argument("--pack", required=True, type=Path, help="作者包目录")
    stage.add_argument("--out", required=True, type=Path, help="版本化内容根目录")
    args = parser.parse_args(argv)
    if args.command == "validate":
        return cmd_validate(args.pack)
    if args.command == "build":
        return cmd_build(args.pack, args.out)
    if args.command == "stage":
        return cmd_stage(args.pack, args.out)
    parser.error("未知命令")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
