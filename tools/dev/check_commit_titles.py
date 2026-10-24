from __future__ import annotations

import argparse
import re
import subprocess
import sys

FEAT_PATTERN = re.compile(r"^feat\([^()\n]+\): [\u3400-\u9fff].+$")
SIMPLE_PATTERN = re.compile(r"^[\u3400-\u9fff][^\n]*$")


def valid(title: str) -> bool:
    text = title.strip()
    if "codex" in text.lower():
        return False
    return bool(FEAT_PATTERN.fullmatch(text) or SIMPLE_PATTERN.fullmatch(text))


def main() -> int:
    parser = argparse.ArgumentParser(description="检查PR标题和提交标题使用中文简述")
    parser.add_argument("--base", help="比较用的Git基线引用")
    parser.add_argument("--title", help="GitHub PR标题")
    args = parser.parse_args()

    titles: list[tuple[str, str]] = []
    if args.title:
        titles.append(("PR标题", args.title))
    if args.base:
        result = subprocess.run(
            ["git", "log", f"{args.base}..HEAD", "--no-merges", "--format=%s"],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode:
            print(result.stderr.strip() or "读取提交标题失败", file=sys.stderr)
            return result.returncode
        titles.extend(("提交标题", line) for line in result.stdout.splitlines() if line.strip())

    invalid = [(kind, title) for kind, title in titles if not valid(title)]
    if invalid:
        for kind, title in invalid:
            print(f"{kind}不符合中文简述或 feat(范围): 中文描述：{title}", file=sys.stderr)
        return 1
    print(f"提交标题检查通过：{len(titles)}项")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
