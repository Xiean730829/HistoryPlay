"""Extract explicit exhibit names for the existing, version-bound catalog search.

This is a fallback after the established intent rules, not an artifact registry.
The caller must still resolve the query and execute through trusted input tools.
"""

import re

_REQUEST = re.compile(
    r"^(?:(?:请|麻烦)(?:你)?)?"
    r"(?:(?:我)?(?:想要|想|要)(?:去)?|(?:带我|帮我|给我)(?:去)?|去|再)?"
    r"(?:去)?"
    r"(?:看看|看一看|瞧一瞧|瞧瞧|看|找找|找|参观|欣赏|走近|靠近|前往|移动到|打开|展示|定位到)"
    r"(?:一下)?"
    r"(?:那头|那尊|那枚|那面|那只|这只|那个|这个|那件|这件)?"
    r"(?P<name>[\u3400-\u9fffA-Za-z0-9·（）()—-]{1,64}?)"
    r"(?:吧|呀|啊)?$"
)
_GO_TO = re.compile(
    r"^(?:(?:请|麻烦)(?:你)?)?(?:带我|帮我|我想|我要|我想要)?(?:走到|去到|到|去)"
    r"(?:那头|那尊|那枚|那件|这件|那个|这个)?"
    r"(?P<name>[\u3400-\u9fffA-Za-z0-9·（）()—-]{1,64}?)"
    r"(?:那里|那边|旁边|面前)?(?:吧|呀|啊)?$"
)
_HELP_LOOK = re.compile(
    r"^(?:请|麻烦)?帮我看(?:看|一下)?(?:那头|那尊|那枚|那面|那只|这只|那个|这个|那件|这件)?"
    r"(?P<name>[\u3400-\u9fffA-Za-z0-9·（）()—-]{1,64}?)"
    r"(?:吧|呀|啊)?$"
)
_QUESTION = re.compile(
    r"为什么|为何|怎么|怎样|如何|是不是|是否|什么时候|是什么|有什么|"
    r"能不能|可不可以|吗|故事|介绍|背景"
)
_STORY_NAME = re.compile(r"^(?:背后|文物背后)$")
_NEGATION = re.compile(
    r"^(?:请)?(?:不|别|先别|暂时不|不要|不用|无需)|"
    r"^(?:我)?(?:不想|不愿|不要)"
)
_CLAUSE_SPLIT = re.compile(r"[，,。！!；;]")
_TRAILING_PARTICLE = re.compile(r"[了吧呀啊]+$")
_CONTEXT_ONLY = {
    "它", "这个", "那个", "东西", "文物", "展品", "物件", "一个文物",
    "一件文物", "一个东西", "里面", "这里", "展厅", "博物馆", "入口",
    "正面", "背面", "下一件", "上一件", "后面", "前面",
}
_DIRECTION_NAME = re.compile(
    r"更深处|深处|更里面|里面|里边|内部|后面|前面|展厅|博物馆|入口"
)


def _last_request_clause(normalized: str) -> str:
    """Keep punctuation as the clause boundary; 了 is only a split after a negation."""
    clauses = _CLAUSE_SPLIT.split(normalized.rstrip("。！!"))
    clause = _TRAILING_PARTICLE.sub("", clauses[-1] if clauses else "")
    if not clause and len(clauses) >= 2:
        clause = _TRAILING_PARTICLE.sub("", clauses[-2])
    if "了" not in clause:
        return clause
    head, _, tail = clause.rpartition("了")
    tail = _TRAILING_PARTICLE.sub("", tail)
    if tail and not _NEGATION.search(tail) and _NEGATION.search(head):
        return tail
    return clause


def locate_clause_is_negated(text: str) -> bool:
    if not isinstance(text, str) or not 0 < len(text) <= 500:
        return False
    normalized = re.sub(r"\s+", "", text)
    clause = _last_request_clause(normalized)
    return bool(clause and _NEGATION.search(clause))


def extract_locate_query(text: str) -> str | None:
    """Return only a bounded name; unknown and ambiguous names stay catalog queries."""
    if not isinstance(text, str) or not 0 < len(text) <= 500:
        return None
    normalized = re.sub(r"\s+", "", text)
    if _QUESTION.search(normalized) or "?" in normalized or "？" in normalized:
        return None
    clause = _last_request_clause(normalized)
    if not clause or _NEGATION.search(clause):
        return None
    match = _REQUEST.fullmatch(clause) or _HELP_LOOK.fullmatch(clause) or _GO_TO.fullmatch(clause)
    if match is None:
        return None
    name = match["name"]
    if name in _CONTEXT_ONLY or _DIRECTION_NAME.search(name) or _STORY_NAME.fullmatch(name):
        return None
    return name


def bare_locate_query(text: str) -> str | None:
    """A short standalone exhibit name still resolves against the live catalog.

    Questions, consent, directions and explanations stay on their existing path.
    Unknown names produce clarification rather than an arbitrary destination.
    """
    if not isinstance(text, str):
        return None
    value = re.sub(r"[\s，。！!、,.]", "", text)
    if (value in _CONTEXT_ONLY or _QUESTION.search(value)
            or re.search(r"[？?]|谢谢|你好|欢迎|多少|是谁|哪件|年代|继续|可以|好的|没问题|当然|嗯|不要|不想|先不", value)):
        return None
    if value in {"牛", "碑", "佛"}:
        return value
    return value if re.fullmatch(r"[\u3400-\u9fffA-Za-z·]{2,24}", value) else None
