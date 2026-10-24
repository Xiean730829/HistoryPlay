#!/usr/bin/env python3
"""Read-only, offline inspection of the existing Xiaozhi web test bridge.

This command never connects to Xiaozhi, opens credentials, or records audio.
It reports only what can be observed in the local reference source; it cannot
establish that a live account or upstream service supports a capability.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Finding:
    capability: str
    status: str
    evidence: str
    limitation: str


def inspect_reference(reference_root: Path) -> list[Finding]:
    server_path = reference_root / "server.py"
    if not server_path.is_file():
        raise FileNotFoundError(f"未找到只读参考文件：{server_path}")

    source = server_path.read_text(encoding="utf-8")
    empty_features = re.search(r"features\s*['\"]?\s*:\s*\{\s*\}", source)
    has_abort_forward = "op == 'abort'" in source and "'type': 'abort'" in source
    has_text_detect = (
        "op == 'text'" in source
        and "'state': 'detect'" in source
        and "'type': 'listen'" in source
    )
    has_mcp_discovery = re.search(
        r"\b(?:mcp|tools)\b.{0,80}(?:discover|list_tools)", source, re.IGNORECASE
    )

    return [
        Finding(
            capability="本地hello声明MCP能力",
            status="observed_empty" if empty_features else "not_demonstrated",
            evidence=(
                "参考桥接代码发送空features对象。"
                if empty_features
                else "未在hello代码中确认空features对象。"
            ),
            limitation="这只描述本地桥接声明；不能据此判断上游服务是否支持MCP。",
        ),
        Finding(
            capability="本地abort转发",
            status="code_path_present" if has_abort_forward else "not_demonstrated",
            evidence=(
                "参考桥接代码把abort与当前session_id转发给上游。"
                if has_abort_forward
                else "未在参考桥接代码中确认abort转发路径。"
            ),
            limitation="静态路径不证明旧工具调用或旧音频已被上游隔离。",
        ),
        Finding(
            capability="固定文本输入路径",
            status="code_path_present" if has_text_detect else "not_demonstrated",
            evidence=(
                "参考桥接把文本输入映射为listen/detect消息。"
                if has_text_detect
                else "未在参考桥接代码中确认文本输入映射。"
            ),
            limitation="文本输入不等于指定稿朗读，也不证明语音来源关联。",
        ),
        Finding(
            capability="MCP工具发现",
            status="source_mentions_discovery" if has_mcp_discovery else "not_evidenced",
            evidence=(
                "参考代码中发现工具发现相关词语；仍需实时协议证据。"
                if has_mcp_discovery
                else "参考桥接源文件没有可识别的MCP工具发现流程。"
            ),
            limitation="本命令不会连接设备或上游服务，因此状态不能提升为通过或不支持。",
        ),
        Finding(
            capability="来源与轮次关联",
            status="not_evidenced",
            evidence="静态检查不覆盖真实语音轮次、工具调用及晚到回复。",
            limitation="需要获准的测试账号或固定模拟设备完成H5预检。",
        ),
    ]


def markdown_report(findings: list[Finding]) -> str:
    rows = [
        "# 小智能力预检（离线静态观察）",
        "",
        "本报告来自本机参考源码的只读扫描，不连接设备或服务，不读取凭据，不录制音频。",
        "静态观察不能替代H5真实账号/模拟设备验收；未验证项不会标为通过。",
        "",
        "| 能力 | 状态 | 可观察证据 | 限制 |",
        "| --- | --- | --- | --- |",
    ]
    for finding in findings:
        rows.append(
            "| {capability} | `{status}` | {evidence} | {limitation} |".format(
                **asdict(finding)
            )
        )
    rows.extend(
        [
            "",
            "## 尚待真实联调",
            "",
            "- MCP入口、工具发现与实际返回预算。",
            "- 播放指定文本，并确认服务端返回的音频与稿件对应。",
            "- 播放中abort后触发新请求，确认旧音频和旧工具结果不能覆盖新轮次。",
            "- 记录可验证的来源/轮次关联；不保存账号令牌、音频或完整私人对话。",
            "- 在上述证据完成前，语音控制路由ADR保持待定。",
        ]
    )
    return "\n".join(rows) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="离线检查小智网页测试桥的静态能力线索；不发起网络请求。"
    )
    parser.add_argument(
        "--reference-root",
        type=Path,
        required=True,
        help="旧版小智网页测试工程目录（只读）。",
    )
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="报告格式；默认markdown。",
    )
    args = parser.parse_args()

    try:
        findings = inspect_reference(args.reference_root.expanduser().resolve())
    except (OSError, UnicodeError) as error:
        print(f"读取失败：{error}", file=sys.stderr)
        return 2

    if args.format == "json":
        print(json.dumps([asdict(item) for item in findings], ensure_ascii=False, indent=2))
    else:
        print(markdown_report(findings), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
