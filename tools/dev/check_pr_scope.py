from __future__ import annotations

import argparse
import subprocess

GENERATED_PATHS = ("package-lock.json", "uv.lock", "generated.ts", "models.py")


def main() -> int:
    parser = argparse.ArgumentParser(description="提示检查PR文件数和手写变更规模")
    parser.add_argument("--base", required=True, help="比较用的Git基线引用")
    args = parser.parse_args()
    result = subprocess.run(
        ["git", "diff", "--numstat", f"{args.base}...HEAD"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    rows = [line.split("\t", 2) for line in result.stdout.splitlines()]
    files = {row[2] for row in rows if len(row) == 3}
    hand_files = {path for path in files if not path.endswith(GENERATED_PATHS)}
    hand_lines = 0
    for added, deleted, path in rows:
        if path.endswith(GENERATED_PATHS) or added == "-" or deleted == "-":
            continue
        hand_lines += int(added) + int(deleted)

    print(f"PR范围提示：{len(hand_files)}个手写文件，约{hand_lines}行手写变更。")
    if len(hand_files) > 12 or hand_lines > 800:
        print("范围超过手册建议值；请确认交付仍是一个可独立审查的结果。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
