"""A bounded, replaceable first-edition Chinese control intent adapter."""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Intent:
    kind: str
    query: str | None = None


RULES = (
    (r"下一段|下个片段|继续下一", "next_segment"),
    (r"^(继续|接着讲|接着说)[吧啊。！!]*$", "resume"),
    (r"回到展台|返回展台|退出故事|返回长廊", "return"),
    (r"背面|翻过来|转过去", "back"),
    (r"正面|恢复角度|转回来", "front"),
    (r"放大|靠近一点", "zoom_in"),
    (r"缩小|远一点", "zoom_out"),
    (r"下一件|下一个文物|往前|前进|往里", "next"),
    (r"上一件|上一个文物|后退|往后", "previous"),
    (r"背后的故事|讲.*故事|看.*故事", "enter_story"),
    (r"介绍|这是什么|背景|讲讲它|讲讲这个", "background"),
)
ALIASES = {"牛": r"牛|卧牛", "铜钱": r"铜钱|钱币|开元通宝", "碑": r"造像碑|石碑|碑"}


def interpret(text: str) -> Intent | None:
    if not isinstance(text, str) or not 0 < len(text) <= 500:
        return None
    text = re.sub(r"\s+", "", text)
    candidates = [
        (match.start(), query)
        for query, pattern in ALIASES.items()
        for match in re.finditer(pattern, text)
    ]
    if (
        candidates
        and re.search(r"看|找|去|换|不要", text)
        and not re.search(r"故事|背景|介绍", text)
    ):
        return Intent("locate", max(candidates)[1])
    for pattern, kind in RULES:
        if re.search(pattern, text):
            return Intent(kind)
    return None
