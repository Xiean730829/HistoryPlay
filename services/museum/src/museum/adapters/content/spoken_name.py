from __future__ import annotations

import unicodedata
from collections.abc import Iterable
from functools import lru_cache

from pypinyin import Style, lazy_pinyin

# Frozen spoken aliases for already-published packs compiled before author YAML
# aliases were expanded. New exhibits should ship aliases in the immutable pack;
# this map is only a compatibility layer keyed by stable artifact id.
COMPAT_SPOKEN_ALIASES: dict[str, tuple[str, ...]] = {
    "cn.tang.artifact.gilt-bronze-bull": (
        "牛",
        "金牛",
        "鎏金牛",
        "流金牛",
        "镏金牛",
        "流金卧牛",
        "那头牛",
        "鎏金铜卧牛",
    ),
    "cn.tang.artifact.kaiyuan-coin": ("钱币", "铜钱", "开元钱", "开元通宝铜钱", "同钱", "铜钳", "铜前"),
    "cn.tang.artifact.votive-stele": (
        "佛像",
        "佛象",
        "佛相",
        "原来的佛像",
        "石碑",
        "碑",
        "造像碑",
        "一佛二菩萨造像碑",
    ),
    "cn.tang.artifact.lute-musician": ("弹拨乐俑", "弹拨乐器俑", "弹拨乐器乐俑"),
    "cn.tang.artifact.flute-musician": ("吹笛乐俑", "吹竹笛乐俑", "吹笛子的乐俑", "吹笛子的"),
    "cn.tang.artifact.woman-figure-mia": ("明尼阿波利斯女俑", "Mia女俑", "MIA女俑"),
    "cn.tang.artifact.buddha-follower": ("抚顶浮雕", "佛陀抚顶浮雕", "佛陀抚触随从头部浮雕"),
    "cn.tang.artifact.dvarapala": ("守门力士", "寺院力士", "寺院守门力士", "佛教门卫守护像"),
}


def normalize_spoken(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().translate(str.maketrans(
        "銅錢樂彈撥門頭鏡觸從頂紋獸婦華", "铜钱乐弹拨门头镜触从顶纹兽妇华"
    ))
    for wrong, correct in (("乐佣", "乐俑"), ("乐勇", "乐俑"), ("女佣", "女俑"), ("人佣", "人俑")):
        value = value.replace(wrong, correct)
    return "".join(char for char in value if not char.isspace() and char not in "，。！？!?、,.；;：:")


@lru_cache(maxsize=4096)
def spoken_pinyin(value: str) -> tuple[str, ...]:
    """Keep syllable boundaries; unknown characters cannot match Chinese syllables."""
    return tuple(lazy_pinyin(normalize_spoken(value), style=Style.NORMAL,
                             errors=lambda chars: [f"#{char}" for char in chars]))


def shared_pinyin_run(left: tuple[str, ...], right: tuple[str, ...]) -> int:
    best = 0
    previous = [0] * (len(right) + 1)
    for syllable in left:
        current = [0] * (len(right) + 1)
        for index, candidate in enumerate(right, start=1):
            if syllable == candidate and not syllable.startswith("#"):
                current[index] = previous[index - 1] + 1
                best = max(best, current[index])
        previous = current
    return best


# Generic group names resolve to categories, never to a single artifact id.
SPOKEN_GENERIC_GROUPS: dict[str, frozenset[str]] = {
    "乐俑": frozenset({"乐俑"}),
    "女俑": frozenset({"陶俑", "女俑"}),
    "人俑": frozenset({"陶俑", "乐俑", "女俑"}),
    "青瓷": frozenset({"青瓷"}),
    "茶盏": frozenset({"茶盏"}),
}


def generic_spoken_categories(query: str) -> frozenset[str]:
    needle = normalize_spoken(query)
    if not needle:
        return frozenset()
    return SPOKEN_GENERIC_GROUPS.get(needle, frozenset())


def exact_spoken_names(
    title: str,
    aliases: Iterable[str],
    artifact_id: str | None = None,
) -> frozenset[str]:
    names = [title, *aliases]
    if artifact_id:
        names.extend(COMPAT_SPOKEN_ALIASES.get(artifact_id, ()))
    return frozenset(normalize_spoken(name) for name in names if isinstance(name, str) and name.strip())
