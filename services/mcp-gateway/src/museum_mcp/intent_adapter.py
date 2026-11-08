"""A bounded, replaceable first-edition Chinese control intent adapter."""

import re
from dataclasses import dataclass

from museum_mcp.locate_query import extract_locate_query, locate_clause_is_negated
from museum_mcp.time_query import era_bounds_from_packs, eras_from_pack_versions, extract_time_query


@dataclass(frozen=True)
class Intent:
    kind: str
    query: str | None = None
    start_year: int | None = None
    end_year: int | None = None
    message: str | None = None


_DEEPER_DIRECTIONS = (
    r"(?:请|麻烦)?(?:带我|帮我)?(?:再|继续)?(?:移动)?(?:往|朝)"
    r"(?:展厅|博物馆)?(?:更深处|深处|更里面|里面|里边|内部)"
    r"(?:走|去|看看|看|看台|展台)?(?:的)?(?:文物|展品)?[吧啊。！!]*"
)
_LOOK_DEEPER = (
    r"(?:请|麻烦)?带我看看(?:更深处|深处|更里面|里面|里边|内部)"
    r"(?:的)?(?:文物|展品|看台|展台)?[吧啊。！!]*"
)


_GROUP_NEXT = re.compile(
    r"(?:带我看看|带我看|看看)?"
    r"(?:后面的文物|后一组|下一组|后面还有什么)"
    r"(?:还有什么)?"
)
_GROUP_PREVIOUS = re.compile(
    r"(?:带我看看|带我看|看看)?(?:前面的文物|前一组|上一组)"
)
_ITEM_NEXT = re.compile(r"下一件|下一个文物|看看后一个文物|后一个文物")
_ITEM_PREVIOUS = re.compile(r"上一件|上一个文物|前一个文物")

RULES = (
    (r"下一段|下个片段|继续下一", "next_segment"),
    (r"^(继续|接着讲|接着说)[吧啊。！!]*$", "resume"),
    (r"回到展台|返回展台|退出故事|返回长廊|回到长廊|回到展厅|返回展厅|回展厅|回到博物馆|远观|全景|退出近看", "return"),
    (r"背面|翻过来|转过去", "back"),
    (r"正面|恢复角度|转回来", "front"),
    (r"放大|靠近一点", "zoom_in"),
    (r"缩小|远一点", "zoom_out"),
    (_DEEPER_DIRECTIONS, "next"),
    (_LOOK_DEEPER, "next"),
    (r"往博物馆后面(?:走+|去)?|往后面(?:走+|去)?|去里面|往里面|再往里|往前|前进|往里", "next"),
    (r"回(?:到)?入口|返回入口|退回入口|往回走|后退|退回|往后(?!面)", "previous"),
    (r"介绍|这是什么|背景|讲讲它|讲讲这个", "background"),
)
# Frozen spoken aliases for already-published packs. New exhibits should ship
# aliases in the immutable content pack; this map is only a compatibility layer.
ALIASES = {
    "牛": r"牛|卧牛|金牛|鎏金牛|鎏金卧牛|流金牛|镏金牛|流金卧牛|鎏金铜卧牛",
    "铜钱": r"铜钱|钱币|开元钱|开元通宝|开元通宝铜钱",
    "碑": r"造像碑|石碑|碑|佛像|原来的佛像|佛陀|佛与二菩萨造像碑|一佛二菩萨(?:造像碑)?|佛",
    "弹拨乐俑": r"弹拨乐俑|弹拨乐器俑|弹拨乐器乐俑",
    "吹笛乐俑": r"吹笛乐俑|吹竹笛乐俑|吹笛子的乐俑|吹笛子的",
    "明尼阿波利斯女俑": r"明尼阿波利斯女俑|Mia女俑|MIA女俑",
    "抚顶浮雕": r"抚顶浮雕|佛陀抚顶浮雕|佛陀抚触随从头部浮雕",
    "守门力士": r"守门力士|寺院力士|寺院守门力士|寺院守门力士像|佛教门卫守护像",
}
_STORY_EXPLICIT_CURRENT = re.compile(
    r"(?:请你给我讲讲这个故事|给我讲讲这个故事|讲讲这个故事|"
    r"我想听它的经历|我想听它的一生|讲讲它的一生|讲讲它的故事|"
    r"请讲当前文物故事|"
    r"带我看看背后的故事|带我看背后的故事|看看背后的故事|"
    r"带我看看故事|带我看故事|看看故事|看故事|"
    r"背后的故事|听故事|讲故事)"
)
_STORY_NAMED = re.compile(
    r"(?:请)?(?:你)?(?:给我)?(?:带我)?(?:讲讲|讲一讲|讲一下|讲|看看|看|听一听|听听|听)(?P<name>.{1,24}?)(?:的)?故事"
)
_STORY_SIMPLE_REQUEST = re.compile(
    r"^(?:(?:请|麻烦)?(?:你)?(?:我想要|我想|我要|带我|给我|帮我)?)"
    r"(?:讲讲|讲一讲|讲一下|讲|看看|看|听一听|听听|听)(?:这个)?故事$"
)
_STORY_STANDALONE_NAMED = re.compile(r"^(?P<name>.{1,24}?)的故事$")
_STORY_CURRENT_REFERENCE = re.compile(
    r"(?:背后|(?:它|这个|这件|这个东西|这件东西|文物|展品|器物|"
    r"这个文物|这件文物|当前文物|现在的文物|当前展品|这个展品|这件展品|"
    r"这个器物|这件器物)(?:的)?(?:背后|相关)?)"
)
_STORY_DECLINE = re.compile(r"先不听|不想听|不要听|别听|不要讲故事|先不要讲|先等等|先别讲")
_STORY_CONSENT = re.compile(
    r"^(?:嗯)?(?:可以讲故事|可以|好啊讲吧|好啊，讲吧|好啊|好的|好|行|当然|没问题|那就听听|"
    r"继续讲这个故事)(?:吧|呀|啊)?$"
)
_STORY_QUESTION = re.compile(r"是真的吗|为什么这样讲|故事里发生了什么|是不是真的")
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
_HALL_ENTRY = re.compile(
    r"(?:请|麻烦)?(?:你)?(?:带我|帮我|我想要|我想|我要)?"
    r"(?:进入|参观|去看|去|看|打开)"
    r"(?:唐代|唐朝|大唐|宋代|宋朝|大宋)"
    r"(?:展厅|展馆|博物馆)?"
    r"(?:吧|呀|啊)?"
    r"(?!文物|展品|年|世纪)"
)
_AMBIGUOUS_TARGET = re.compile(
    r"(?:请|麻烦)?(?:帮我|带我|我想)?(?:移动|走近|去)?"
    r"(?:看|看看|找)?(?:一个|一件|某个)?(?:东西|文物|展品|物件)(?:吧|呢|呀)?"
)


_REQUEST_PREFIX = re.compile(
    r"^(?:(?:请|麻烦)(?:你)?)?"
    r"(?:(?:我)?(?:想要|想|要)(?:去)?|(?:带我|帮我|给我)(?:去)?|去|再)?"
    r"(?:去)?"
    r"(?:看看|看一看|瞧一瞧|瞧瞧|看|找找|找|参观|欣赏|走近|靠近|前往|移动到|换)?"
    r"(?:一下)?(?:那头|那尊|那枚|那面|那只|这只|那件|这件|那个|这个)?$"
)
_REQUEST_SUFFIX = re.compile(r"^(?:吧|呀|啊|了|的|放大(?:一点)?|靠近(?:一点)?|缩小|远一点)?$")


def _complete_alias_query(name: str) -> str | None:
    for query, pattern in ALIASES.items():
        if re.fullmatch(pattern, name):
            return query
    return None


def _alias_is_complete_target(text: str, match: re.Match[str]) -> bool:
    if re.search(
        r"不要(?:看)?$|别(?:再)?看$|不想(?:看)?$|不是$",
        text[max(0, match.start() - 8) : match.start()],
    ):
        return False
    prefix = text[: match.start()]
    suffix = text[match.end() :]
    if prefix and not _REQUEST_PREFIX.fullmatch(prefix):
        return False
    return not suffix or bool(_REQUEST_SUFFIX.fullmatch(suffix))


def interpret(text: str, *, pack_versions: dict[str, str] | None = None) -> Intent | None:
    if not isinstance(text, str) or not 0 < len(text) <= 500:
        return None
    text = re.sub(r"\s+", "", text)
    if not _NEGATED_ENTRY.search(text) and (
        _SHORT_ENTRY.fullmatch(text) or _CLEAR_ENTRY.fullmatch(text) or _HALL_ENTRY.fullmatch(text)
    ):
        return None
    if re.search(r"为什么|为何|怎么会|是不是|是否|什么时候|怎样制作|什么年代|发生了什么", text) and (
        not _STORY_NAMED.search(text) or _STORY_QUESTION.search(text)
    ):
        return None
    story_intent = _story_intent(re.sub(r"[，。！？!?、,.]", "", text))
    if story_intent is not None:
        return story_intent
    # Scope negation to the same clause as a movement phrase. A preceding
    # object-level negation (for example, “不要看铜钱了，再往前走”) must not
    # cancel a later, affirmative movement request.
    movement_clause = re.split(r"[，,。！？；;]", text)[-1]
    if re.search(
        r"(?:不要|别|不想|不用|无需).{0,12}(?:往前|前进|往里|往里面|再往里|去里面|后面|后退|往后|往回|回入口|返回入口|下一件|上一件|下一组|上一组|后面的文物|前面的文物)",
        movement_clause,
    ):
        return None
    if _GROUP_NEXT.search(text) and not re.search(r"什么年代|为什么|是否", text):
        return Intent("browse_next")
    if _GROUP_PREVIOUS.search(text) and not re.search(r"什么年代|为什么|是否", text):
        return Intent("browse_previous")
    if _ITEM_NEXT.fullmatch(text) or (_ITEM_NEXT.search(text) and len(text) <= 12):
        return Intent("next")
    if _ITEM_PREVIOUS.fullmatch(text) or (_ITEM_PREVIOUS.search(text) and len(text) <= 12):
        return Intent("previous")
    if re.search(r"远观|全景|退出近看", text) and not re.search(r"不要|别|不想", text):
        return Intent("return")
    available = eras_from_pack_versions(pack_versions)
    era_start, era_end = era_bounds_from_packs(pack_versions)
    time_query = extract_time_query(
        text, available_eras=available, era_start=era_start, era_end=era_end
    )
    if time_query is not None:
        if time_query.kind == "clear":
            return Intent("seek_clear")
        if time_query.kind == "unavailable":
            return Intent("unavailable_era", message=time_query.message)
        if time_query.kind == "clarify":
            return Intent("clarify_time", message=time_query.message)
        if time_query.kind == "range":
            return Intent("seek_time", start_year=time_query.start_year, end_year=time_query.end_year)
    extracted = extract_locate_query(text)
    if extracted:
        return Intent("locate", _complete_alias_query(extracted) or extracted)
    if locate_clause_is_negated(text):
        return None
    candidates = [
        (len(match.group()), match.start(), query)
        for query, pattern in ALIASES.items()
        for match in re.finditer(pattern, text)
        if _alias_is_complete_target(text, match)
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
    return None


def is_entry_request(text: str) -> bool:
    value = re.sub(r"[\s，。！？!?、,.]", "", text)
    return not _NEGATED_ENTRY.search(value) and bool(
        _SHORT_ENTRY.fullmatch(value) or _CLEAR_ENTRY.fullmatch(value) or _HALL_ENTRY.fullmatch(value)
    )


def _story_intent(text: str) -> Intent | None:
    if _STORY_QUESTION.search(text):
        return None
    if _STORY_DECLINE.search(text):
        return Intent("story_decline")
    if _STORY_SIMPLE_REQUEST.fullmatch(text):
        return Intent("story_current")
    named = _STORY_NAMED.search(text) or _STORY_STANDALONE_NAMED.fullmatch(text)
    if named:
        name = named["name"].strip()
        if _STORY_CURRENT_REFERENCE.fullmatch(name):
            return Intent("story_current")
        return Intent("story_named", _complete_alias_query(name) or name)
    if _STORY_EXPLICIT_CURRENT.search(text):
        return Intent("story_current")
    if _STORY_CONSENT.fullmatch(text):
        return Intent("story_consent")
    if "故事" in text:
        return Intent("story_current")
    return None
