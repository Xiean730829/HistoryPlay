import pytest
from museum_mcp.intent_adapter import interpret


@pytest.mark.parametrize(
    "utterance",
    [
        "往博物馆后面走走",
        "去里面",
        "再往里",
        "往里面走",
        "往深处走",
        "不要看铜钱了，往深处走",
        "带我看看更里面的文物",
        "帮我移动往深处看台",
    ],
)
def test_inside_directions_advance_one_station(utterance):
    assert interpret(utterance).kind == "next"


@pytest.mark.parametrize("utterance", ["带我进去", "可以", "进入博物馆"])
def test_entry_consent_is_not_reinterpreted_as_an_in_gallery_action(utterance):
    assert interpret(utterance) is None


@pytest.mark.parametrize(
    ("utterance", "query"),
    [
        ("带我去看牛", "牛"),
        ("去看牛", "牛"),
        ("带我去看铜钱", "铜钱"),
        ("想看看铜钱", "铜钱"),
        ("我想看佛像", "碑"),
        ("走近佛像", "碑"),
        ("靠近佛像", "碑"),
        ("佛像放大", "碑"),
        ("带我去看佛像", "碑"),
    ],
)
def test_artifact_requests_are_not_swallowed_by_entry_consent(utterance, query):
    assert interpret(utterance).kind == "locate"
    assert interpret(utterance).query == query


def test_ambiguous_artifact_request_asks_for_a_name_instead_of_silently_failing():
    assert interpret("移动看一个东西").kind == "clarify_target"


@pytest.mark.parametrize("utterance", ["回入口", "回到入口", "退回入口", "后退"])
def test_return_directions_move_one_station_toward_entrance(utterance):
    assert interpret(utterance).kind == "previous"


@pytest.mark.parametrize("utterance", ["回到展厅", "回展厅", "返回展厅", "回到长廊"])
def test_return_hall_phrases_return_from_current_exhibit(utterance):
    assert interpret(utterance).kind == "return"


@pytest.mark.parametrize(
    "utterance",
    [
        "不要往博物馆后面走",
        "不要往里面走",
        "别去里面",
        "我不想后退",
        "不用回入口",
        "不要进去",
    ],
)
def test_negated_directions_do_not_move(utterance):
    assert interpret(utterance) is None


def test_question_about_moving_remains_a_question():
    assert interpret("为什么不往博物馆后面走？") is None


@pytest.mark.parametrize(
    ("utterance", "query"),
    [
        ("看弹拨乐俑", "弹拨乐俑"),
        ("带我去看弹拨乐器俑", "弹拨乐俑"),
        ("看吹笛乐俑", "吹笛乐俑"),
        ("看吹笛子的", "吹笛乐俑"),
        ("看Mia女俑", "明尼阿波利斯女俑"),
        ("看明尼阿波利斯女俑", "明尼阿波利斯女俑"),
        ("看抚顶浮雕", "抚顶浮雕"),
        ("看佛陀抚顶浮雕", "抚顶浮雕"),
        ("看守门力士", "守门力士"),
        ("看寺院力士", "守门力士"),
        ("不看铜钱，带我看吹笛乐俑", "吹笛乐俑"),
    ],
)
def test_new_tang_artifact_names_locate_without_taking_old_aliases(utterance, query):
    intent = interpret(utterance)
    assert intent.kind == "locate"
    assert intent.query == query


def test_buddha_statue_phrase_still_locates_the_original_stele():
    intent = interpret("我想看佛像")
    assert intent.kind == "locate"
    assert intent.query == "碑"


def test_question_about_a_new_exhibit_does_not_move():
    assert interpret("吹笛乐俑为什么是这个姿势？") is None
    assert interpret("这个俑就是某位宫女吗？") is None
