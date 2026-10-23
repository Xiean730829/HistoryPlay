from __future__ import annotations

import argparse
import sys
from pathlib import Path

from content_pipeline.validation.schema_validator import validate_pack


def cmd_validate(pack: Path) -> int:
    if not pack.is_dir():
        print(f"内容包目录不存在：{pack}", file=sys.stderr)
        return 2
    issues = validate_pack(pack)
    if issues:
        for issue in issues:
            print(issue, file=sys.stderr)
        print(f"校验失败：{len(issues)} 项", file=sys.stderr)
        return 1
    print(f"源稿 Schema 校验通过：{pack}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="内容制作命令")
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate", help="按公共 Schema 校验作者源稿")
    validate.add_argument("--pack", required=True, type=Path, help="作者包目录")
    args = parser.parse_args(argv)
    if args.command == "validate":
        return cmd_validate(args.pack)
    parser.error("未知命令")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
