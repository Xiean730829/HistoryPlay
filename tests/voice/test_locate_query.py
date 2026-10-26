import pytest
from museum_mcp.intent_adapter import interpret
from museum_mcp.locate_query import extract_locate_query


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("看镇墓兽", "镇墓兽"),
        ("我想看看铜镜", "铜镜"),
        ("带我去看双龙耳瓶", "双龙耳瓶"),
        ("麻烦你带我去看骑马俑", "骑马俑"),
        ("请看一下那件净水瓶吧", "净水瓶"),
        ("前往天龙山力士头像", "天龙山力士头像"),
        ("不要看铜钱了，带我看镇墓兽", "镇墓兽"),
        ("看  唐代铜镜。", "唐代铜镜"),
    ],
)
def test_explicit_new_names_use_existing_locate_path(text, expected):
    assert extract_locate_query(text) == expected
    intent = interpret(text)
    assert intent is not None
    assert (intent.kind, intent.query) == ("locate", expected)


@pytest.mark.parametrize(
    "text",
    [
        "不要看镇墓兽", "别看双龙耳瓶", "我不想看镇墓兽", "铜镜是什么",
        "我想看铜镜的故事", "看看镇墓兽是什么", "为什么要看镇墓兽",
        "能不能带我看镇墓兽", "看镇墓兽吗", "看这个", "看文物",
        "看一个东西", "看博物馆", "回到展厅", "继续", "放大一点",
        "看https://example.com", "看../private", "看甲" + "乙" * 64,
        "看镇墓兽？", "",
    ],
)
def test_non_navigation_and_unbounded_input_are_not_extracted(text):
    assert extract_locate_query(text) is None


def test_new_names_are_queries_not_fabricated_catalog_ids():
    intent = interpret("看不存在的青玉杯")
    assert intent is not None
    assert intent.query == "不存在的青玉杯"
    assert not intent.query.startswith("cn.")


def test_existing_context_and_story_commands_keep_priority():
    assert interpret("回到展厅").kind == "return"
    assert interpret("往深处走").kind == "next"
    assert interpret("背后的故事").kind == "enter_story"
    assert interpret("看铜钱").query == "铜钱"
    assert interpret("我想看佛像").query == "碑"
