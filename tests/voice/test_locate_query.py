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
        ("不要看铜钱了去看牛", "牛"),
        ("看铜镜了", "铜镜"),
        ("我想看天龙山坐佛了", "天龙山坐佛"),
        ("再看铜钱", "铜钱"),
        ("再看看铜钱", "铜钱"),
        ("再看看弹拨乐俑", "弹拨乐俑"),
        ("再看看铜镜", "铜镜"),
        ("给我看看镇墓兽", "镇墓兽"),
        ("给我看镇墓兽", "镇墓兽"),
        ("看  唐代铜镜。", "唐代铜镜"),
        ("我想要去看牛", "牛"),
        ("带我瞧瞧铜钱", "铜钱"),
        ("看一下那枚铜钱", "铜钱"),
        ("帮我看铜钱", "铜钱"),
        ("帮我看弹拨乐俑", "弹拨乐俑"),
        ("帮我看看吹笛乐俑", "吹笛乐俑"),
        ("帮我看守门力士", "守门力士"),
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
        "不要看镇墓兽", "别看双龙耳瓶", "我不想看镇墓兽",
        "别再看铜钱了", "我不想看铜镜了", "铜镜是什么",
        "我想看铜镜的故事", "看看镇墓兽是什么", "为什么要看镇墓兽",
        "看故事", "背后的故事", "带我看看背后的故事",
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


def test_help_look_buddha_image_extracts_name_then_alias():
    assert extract_locate_query("帮我看看佛像") == "佛像"
    intent = interpret("帮我看看佛像")
    assert intent is not None
    assert (intent.kind, intent.query) == ("locate", "碑")


def test_existing_context_and_story_commands_keep_priority():
    assert interpret("回到展厅").kind == "return"
    assert interpret("往深处走").kind == "next"
    assert interpret("背后的故事").kind == "story_current"
    assert interpret("看故事").kind == "story_current"
    assert interpret("带我看看背后的故事").kind == "story_current"
    assert interpret("看铜钱").query == "铜钱"
    assert interpret("我想看佛像").query == "碑"
    assert interpret("我想要去看牛").query == "牛"
    assert interpret("看那个金牛").query == "牛"
    assert interpret("我要去看流金牛").query == "牛"
    assert interpret("我想看看那尊佛像").query == "碑"
    assert interpret("看一下那枚铜钱").query == "铜钱"
    assert extract_locate_query("看那个金牛") == "金牛"
    assert extract_locate_query("我要去看流金牛") == "流金牛"
    assert interpret("看天龙山坐佛").query == "天龙山坐佛"
    assert interpret("看佛陀抚顶浮雕").query == "抚顶浮雕"
    assert interpret("看天龙山力士头像").query == "天龙山力士头像"
