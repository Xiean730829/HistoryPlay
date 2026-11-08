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


@pytest.mark.parametrize(
    "utterance",
    ["带我进去", "可以", "进入博物馆", "进入宋代", "进入唐代", "带我进入宋代展厅", "我要去看唐朝"],
)
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
        ("再看看弹拨乐俑", "弹拨乐俑"),
        ("再看铜钱", "铜钱"),
        ("给我看看镇墓兽", "镇墓兽"),
        ("看铜镜了", "铜镜"),
        ("我想看天龙山坐佛了", "天龙山坐佛"),
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
    assert interpret("镇墓兽是什么") is None
    assert interpret("为什么这样") is None


@pytest.mark.parametrize("utterance", ["别再看铜钱了", "我不想看铜镜了"])
def test_negated_repeat_look_does_not_move(utterance):
    assert interpret(utterance) is None


@pytest.mark.parametrize(
    ("utterance", "query"),
    [
        ("看佛像", "碑"),
        ("看天龙山坐佛", "天龙山坐佛"),
        ("看佛陀抚顶浮雕", "抚顶浮雕"),
        ("看天龙山力士头像", "天龙山力士头像"),
        ("看铜镜", "铜镜"),
        ("看铜钱", "铜钱"),
        ("不看铜钱，带我看镇墓兽", "镇墓兽"),
        ("看女俑", "女俑"),
        ("看不存在的文物", "不存在的文物"),
    ],
)
def test_full_exhibit_names_are_not_stolen_by_short_aliases(utterance, query):
    intent = interpret(utterance)
    assert intent is not None
    assert intent.kind == "locate"
    assert intent.query == query


@pytest.mark.parametrize("utterance", ["往深处走", "回到展厅", "放大一点"])
def test_control_phrases_keep_priority_over_exhibit_names(utterance):
    intent = interpret(utterance)
    assert intent is not None
    assert intent.kind in {"next", "return", "zoom_in"}
    assert intent.query is None


@pytest.mark.parametrize(
    "utterance",
    ["带我看看后面的文物", "后面还有什么", "下一组"],
)
def test_group_next_phrases_browse_instead_of_old_previous(utterance):
    assert interpret(utterance).kind == "browse_next"


@pytest.mark.parametrize("utterance", ["带我看看前面的文物", "前一组", "上一组"])
def test_group_previous_phrases_browse_one_window(utterance):
    assert interpret(utterance).kind == "browse_previous"


@pytest.mark.parametrize("utterance", ["下一件", "看看后一个文物", "后一个文物"])
def test_item_next_phrases_still_move_one_exhibit(utterance):
    assert interpret(utterance).kind == "next"


@pytest.mark.parametrize("utterance", ["上一件", "前一个文物"])
def test_item_previous_phrases_still_move_one_exhibit(utterance):
    assert interpret(utterance).kind == "previous"


@pytest.mark.parametrize(
    "utterance",
    ["别带我看后面的文物", "下一件是什么年代", "后面的文物是什么年代"],
)
def test_group_questions_and_negation_do_not_browse(utterance):
    assert interpret(utterance) is None


def test_time_intents_are_recognized_before_artifact_names():
    seek = interpret("带我看750年的文物")
    assert seek.kind == "seek_time"
    assert (seek.start_year, seek.end_year) == (750, 750)
    century = interpret("看八世纪的文物")
    assert century.kind == "seek_time"
    assert (century.start_year, century.end_year) == (701, 800)
    assert interpret("清除时间筛选").kind == "seek_clear"
    assert interpret("看宋朝的文物").kind == "unavailable_era"
    assert interpret("进入宋代") is None
    assert interpret("进入唐代") is None
    assert interpret("看开元通宝").kind == "locate"
    assert interpret("看开元通宝").query == "铜钱"
    song_year = interpret("看宋代1100年前后", pack_versions={"cn.song.core": "0.1.0"})
    assert song_year is not None and song_year.kind == "seek_time"
    assert (song_year.start_year, song_year.end_year) == (1100, 1100)
    assert interpret("看宋朝的文物", pack_versions={"cn.song.core": "0.1.0"}).kind == "clarify_time"


@pytest.mark.parametrize(
    ("utterance", "kind", "query"),
    [
        ("请你给我讲讲这个故事", "story_current", None),
        ("我想听它的一生", "story_current", None),
        ("看故事", "story_current", None),
        ("背后的故事", "story_current", None),
        ("带我看看背后的故事", "story_current", None),
        ("带我听一听故事", "story_current", None),
        ("带我听一听背后的故事", "story_current", None),
        ("带我听一听铜镜的故事", "story_named", "铜镜"),
        ("听故事", "story_current", None),
        ("讲故事", "story_current", None),
        ("我想听故事", "story_current", None),
        ("我要听文物的故事", "story_current", None),
        ("我想听这件文物的故事", "story_current", None),
        ("我要听这个文物背后的故事", "story_current", None),
        ("我想听它背后的故事", "story_current", None),
        ("请讲这件展品的故事", "story_current", None),
        ("讲讲这个器物的故事", "story_current", None),
        ("我要听铜钱的故事", "story_named", "铜钱"),
        ("我要听铜钱故事", "story_named", "铜钱"),
        ("我想听青白瓷注子的故事", "story_named", "青白瓷注子"),
        ("讲讲铜钱的故事", "story_named", "铜钱"),
        ("看金牛的故事", "story_named", "牛"),
        ("好啊讲吧", "story_consent", None),
        ("那就听听", "story_consent", None),
        ("先不听", "story_decline", None),
        ("不要讲故事", "story_decline", None),
        ("不想听故事", "story_decline", None),
    ],
)
def test_story_phrases_are_structured_requests_not_questions(utterance, kind, query):
    intent = interpret(utterance)
    assert intent is not None
    assert intent.kind == kind
    assert intent.query == query


@pytest.mark.parametrize(
    "utterance",
    ["铜钱的故事是真的吗", "牛的故事是真的吗", "为什么这样讲", "故事里发生了什么"],
)
def test_story_questions_stay_questions(utterance):
    assert interpret(utterance) is None
