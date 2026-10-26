"""A bounded, replaceable first-edition Chinese control intent adapter."""

import re
from dataclasses import dataclass

from museum_mcp.locate_query import extract_locate_query


@dataclass(frozen=True)
class Intent:
    kind: str
    query: str | None = None


_DEEPER_DIRECTIONS = (
    r"(?:请|麻烦)?(?:带我|帮我)?(?:再|继续)?(?:移动)?(?:往|朝)"
    r"(?:展厅|博物馆)?(?:更深处|深处|更里面|里面|里边|内部)"
    r"(?:走|去|看看|看|看台|展台)?(?:的)?(?:文物|展品)?[吧啊。！!]*"
)
_LOOK_DEEPER = (
    r"(?:请|麻烦)?带我看看(?:更深处|深处|更里面|里面|里边|内部)"
    r"(?:的)?(?:文物|展品|看台|展台)?[吧啊。！!]*"
)


RULES = (
    (r"下一段|下个片段|继续下一", "next_segment"),
    (r"^(继续|接着讲|接着说)[吧啊。！!]*$", "resume"),
    (r"回到展台|返回展台|退出故事|返回长廊|回到长廊|回到展厅|返回展厅|回展厅|回到博物馆", "return"),
    (r"背面|翻过来|转过去", "back"),
    (r"正面|恢复角度|转回来", "front"),
    (r"放大|靠近一点", "zoom_in"),
    (r"缩小|远一点", "zoom_out"),
    (_DEEPER_DIRECTIONS, "next"),
    (_LOOK_DEEPER, "next"),
    (r"下一件|下一个文物|往博物馆后面(?:走+|去)?|往后面(?:走+|去)?|去里面|往里面|再往里|往前|前进|往里", "next"),
    (r"上一件|上一个文物|回(?:到)?入口|返回入口|退回入口|往回走|后退|退回|往后(?!面)", "previous"),
    (r"背后的故事|讲.*故事|看.*故事", "enter_story"),
    (r"介绍|这是什么|背景|讲讲它|讲讲这个", "background"),
)
ALIASES = {
    "牛": r"牛|卧牛",
    "铜钱": r"铜钱|钱币|开元通宝",
    "碑": r"造像碑|石碑|碑|佛像|佛陀|佛与二菩萨造像碑|一佛二菩萨(?:造像碑)?|佛",
    "弹拨乐俑": r"弹拨乐俑|弹拨乐器俑|弹拨乐器乐俑",
    "吹笛乐俑": r"吹笛乐俑|吹竹笛乐俑|吹笛子的",
    "明尼阿波利斯女俑": r"明尼阿波利斯女俑|Mia女俑|MIA女俑",
    "抚顶浮雕": r"抚顶浮雕|佛陀抚顶浮雕|佛陀抚触随从头部浮雕",
    "守门力士": r"守门力士|寺院力士|寺院守门力士|佛教门卫守护像",
}
_NEGATED_ENTRY = re.compile(
    r"(?:不|别|先别|暂时不)(?:要|想|愿意|需要|准备|打算|可以)?"
    r"(?:我|带我|带你|让我)?(?:走进|进入|进去|进馆|参观|进|去)"
)
_CLEAR_ENTRY = re.compile(
    r"(?:(?:请)?带我(?:走进|进入|进去|进馆|进|去)"
    r"(?:博物馆|展厅|展馆|大厅|里面)?|"
    r"(?:我)?(?:想|要|愿意)?(?:走进|进入|进去|进馆|参观)"
    r"(?:博物馆|展厅|展馆)?(?:吧|呀)?|"
    r"进馆吧|进去吧|进入博物馆|进入展厅)"
)
_SHORT_ENTRY = re.compile(
    r"(?:嗯)?(?:可以|好|好的|行|当然|没问题|走吧|进馆|进入博物馆|带我进去|"
    r"带我进去吧|开始参观)(?:啊|的)?(?:带我进去|进入博物馆|开始参观)?(?:吧|呀)?"
)
_AMBIGUOUS_TARGET = re.compile(
    r"(?:请|麻烦)?(?:帮我|带我|我想)?(?:移动|走近|去)?"
    r"(?:看|看看|找)?(?:一个|一件|某个)?(?:东西|文物|展品|物件)(?:吧|呢|呀)?"
)


def interpret(text: str) -> Intent | None:
    if not isinstance(text, str) or not 0 < len(text) <= 500:
        return None
    text = re.sub(r"\s+", "", text)
    if not _NEGATED_ENTRY.search(text) and (
        _SHORT_ENTRY.fullmatch(text) or _CLEAR_ENTRY.fullmatch(text)
    ):
        return None
    if re.search(r"为什么|为何|怎么会|是不是|是否|什么时候|怎样制作", text):
        return None
    # Scope negation to the same clause as a movement phrase. A preceding
    # object-level negation (for example, “不要看铜钱了，再往前走”) must not
    # cancel a later, affirmative movement request.
    movement_clause = re.split(r"[，,。！？；;]", text)[-1]
    if re.search(
        r"(?:不要|别|不想|不用|无需).{0,8}(?:往前|前进|往里|往里面|再往里|去里面|后面|后退|往后|往回|回入口|返回入口|下一件|上一件)",
        movement_clause,
    ):
        return None
    candidates = [
        (len(match.group()), match.start(), query)
        for query, pattern in ALIASES.items()
        for match in re.finditer(pattern, text)
        if not re.search(
            r"不要(?:看)?$|别看$|不想(?:看)?$|不是$",
            text[max(0, match.start() - 6) : match.start()],
        )
    ]
    if (
        candidates
        and re.search(r"看|找|去|换|不要|走近|靠近|放大|移动到|前往", text)
        and not re.search(r"故事|背景|介绍", text)
    ):
        return Intent("locate", max(candidates)[2])
    if _AMBIGUOUS_TARGET.fullmatch(text):
        return Intent("clarify_target")
    for pattern, kind in RULES:
        if re.search(pattern, text):
            return Intent(kind)
    query = extract_locate_query(text)
    return Intent("locate", query) if query else None
