"""Parse year, year-range and century utterances into a bounded time filter."""

from __future__ import annotations

import re
from dataclasses import dataclass

OPEN_ERA_START = 618
OPEN_ERA_END = 907

_DIGITS = {
    "零": 0,
    "〇": 0,
    "○": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_QUESTION = re.compile(r"为什么|为何|怎么会|是不是|是否|什么时候|怎样制作|什么年代|发生了什么")
_NEGATION = re.compile(r"(?:不要|别|不想|不用|无需|不是).{0,12}(?:年|世纪|筛选|唐朝文物|宋朝文物)")
_CLEAR = re.compile(
    r"(?:清除时间筛选|清除筛选|取消筛选|看全部唐朝文物|看所有唐朝文物|看全部宋朝文物|看全部文物)"
)
_HALL_ENTRY = re.compile(r"(?:进入|参观)(?:唐代|唐朝|大唐|宋代|宋朝|大宋)")
_NAMED_ERA = (
    (re.compile(r"宋朝|宋代|大宋"), "song"),
    (re.compile(r"唐朝|唐代|大唐"), "tang"),
    (re.compile(r"明朝|明代"), "ming"),
    (re.compile(r"元朝|元代"), "yuan"),
    (re.compile(r"清朝|清代"), "qing"),
    (re.compile(r"汉朝|汉代"), "han"),
)
_ERA_BOUNDS = {
    "tang": (OPEN_ERA_START, OPEN_ERA_END),
    "song": (960, 1279),
}
_CENTURY = re.compile(r"(?:公元)?([0-9]{1,2}|[一二三四五六七八九十两]+)世纪")
_RANGE_SEP = r"(?:到|至|—|–|-|～|~)"
_YEAR = r"(?:公元)?({year})年?"
_YEAR_TOKEN = r"[0-9]{3,4}|[一二三四五六七八九十两百千零〇○两]+"


@dataclass(frozen=True)
class TimeQuery:
    kind: str
    start_year: int | None = None
    end_year: int | None = None
    message: str | None = None


def eras_from_pack_versions(pack_versions: dict[str, str] | None) -> frozenset[str]:
    if not pack_versions:
        return frozenset({"tang"})
    found: set[str] = set()
    for pack_id in pack_versions:
        if pack_id.startswith("cn.song"):
            found.add("song")
        elif pack_id.startswith("cn.tang"):
            found.add("tang")
    return frozenset(found) or frozenset({"tang"})


def era_bounds_from_packs(pack_versions: dict[str, str] | None) -> tuple[int, int]:
    eras = eras_from_pack_versions(pack_versions)
    if eras == {"song"}:
        return _ERA_BOUNDS["song"]
    if "song" in eras and "tang" in eras:
        return min(_ERA_BOUNDS["tang"][0], _ERA_BOUNDS["song"][0]), max(_ERA_BOUNDS["tang"][1], _ERA_BOUNDS["song"][1])
    return _ERA_BOUNDS["tang"]


def extract_time_query(
    text: str,
    *,
    available_eras: frozenset[str] | None = None,
    era_start: int | None = None,
    era_end: int | None = None,
) -> TimeQuery | None:
    if not isinstance(text, str) or not 0 < len(text) <= 500:
        return None
    compact = re.sub(r"\s+", "", text)
    if _QUESTION.search(compact) or _NEGATION.search(compact) or _HALL_ENTRY.search(compact):
        return None
    open_eras = available_eras if available_eras is not None else frozenset({"tang"})
    start_bound = OPEN_ERA_START if era_start is None else era_start
    end_bound = OPEN_ERA_END if era_end is None else era_end
    if _CLEAR.search(compact):
        return TimeQuery("clear")
    named = next((era for pattern, era in _NAMED_ERA if pattern.search(compact)), None)
    if named and named not in open_eras:
        label = "宋朝" if "song" in open_eras else "唐朝"
        return TimeQuery("unavailable", message=f"当前只开放{label}文物，该朝代尚未开放")
    if named and named in open_eras and re.search(r"文物|展品", compact) and not re.search(r"年|世纪", compact):
        return TimeQuery("clarify", message="已经在当前朝代展厅。请说出文物名称、卷次或年份。")
    century = _CENTURY.search(compact)
    if century and "年" not in compact:
        value = _parse_number(century.group(1))
        if value is None or value <= 0:
            return TimeQuery("clarify", message="请说出完整的世纪，例如八世纪")
        start = (value - 1) * 100 + 1
        end = value * 100
        return _bounded_range(start, end, start_bound, end_bound, open_eras)
    years = [_parse_number(match.group(1)) for match in re.finditer(rf"({_YEAR_TOKEN})年", compact)]
    years = [item for item in years if item is not None]
    if not years or re.search(_RANGE_SEP, compact):
        for match in re.findall(r"(?<!\d)(\d{3,4})(?!\d)", compact):
            value = int(match)
            if value not in years:
                years.append(value)
    if not years:
        return None
    if len(years) == 1:
        if (
            re.search(_RANGE_SEP, compact)
            or compact.endswith(("到", "至"))
        ):
            return TimeQuery("clarify", message="请同时说出起始和结束年份")
        year = years[0]
        return _bounded_range(year, year, start_bound, end_bound, open_eras)
    return _bounded_range(years[0], years[1], start_bound, end_bound, open_eras)


def _bounded_range(
    start: int, end: int, era_start: int, era_end: int, open_eras: frozenset[str]
) -> TimeQuery:
    low, high = min(start, end), max(start, end)
    if high < era_start or low > era_end:
        label = "宋朝" if open_eras == {"song"} else "唐朝"
        return TimeQuery("unavailable", message=f"当前只开放{label}文物，该年代尚未开放")
    return TimeQuery("range", start_year=low, end_year=high)


def _parse_number(raw: str) -> int | None:
    if raw.isdigit():
        return int(raw)
    if not raw:
        return None
    if raw in _DIGITS:
        return _DIGITS[raw]
    if "十" not in raw and "百" not in raw and "千" not in raw:
        total = 0
        for char in raw:
            if char not in _DIGITS:
                return None
            total = total * 10 + _DIGITS[char]
        return total
    total = 0
    current = 0
    for char in raw:
        if char in _DIGITS:
            current = _DIGITS[char]
            continue
        if char == "千":
            total += (current or 1) * 1000
            current = 0
        elif char == "百":
            total += (current or 1) * 100
            current = 0
        elif char == "十":
            total += (current or 1) * 10
            current = 0
        else:
            return None
    return total + current
