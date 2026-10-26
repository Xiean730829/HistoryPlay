"""Extract explicit exhibit names for the existing, version-bound catalog search.

This is a fallback after the established intent rules, not an artifact registry.
The caller must still resolve the query and execute through trusted input tools.
"""

import re

_REQUEST = re.compile(
    r"^(?:(?:请|麻烦)(?:你)?)?"
    r"(?:(?:我)?(?:想|要)(?:去)?|(?:带我|帮我)(?:去)?)?"
    r"(?:看看|看一看|看|找找|找|参观|欣赏|走近|靠近|前往|移动到)"
    r"(?:一下)?(?:那件|这件|那个|这个)?"
    r"(?P<name>[\u3400-\u9fffA-Za-z0-9·（）()—-]{1,64}?)"
    r"(?:吧|呀|啊)?$"
)
_QUESTION = re.compile(
    r"为什么|为何|怎么|怎样|如何|是不是|是否|什么时候|是什么|有什么|"
    r"能不能|可不可以|吗|故事|介绍|背景"
)
_NEGATION = re.compile(r"^(?:请)?(?:不|别|先别|暂时不|不要|不用|无需)")
_CONTEXT_ONLY = {
    "它", "这个", "那个", "东西", "文物", "展品", "物件", "一个文物",
    "一件文物", "一个东西", "里面", "这里", "展厅", "博物馆", "入口",
    "正面", "背面", "下一件", "上一件", "后面", "前面",
}


def extract_locate_query(text: str) -> str | None:
    """Return only a bounded name; unknown and ambiguous names stay catalog queries."""
    if not isinstance(text, str) or not 0 < len(text) <= 500:
        return None
    normalized = re.sub(r"\s+", "", text)
    if _QUESTION.search(normalized) or "?" in normalized or "？" in normalized:
        return None
    # An explicit new request after a negated object may still be affirmative.
    clause = re.split(r"[，,。！!；;]", normalized.rstrip("。！!"))[-1]
    if _NEGATION.search(clause):
        return None
    match = _REQUEST.fullmatch(clause)
    if match is None:
        return None
    name = match["name"]
    if name in _CONTEXT_ONLY:
        return None
    return name
