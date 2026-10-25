import pytest
from museum_mcp.intent_adapter import interpret


@pytest.mark.parametrize(
    "utterance",
    ["往博物馆后面走走", "去里面", "再往里", "往里面走"],
)
def test_inside_directions_advance_one_station(utterance):
    assert interpret(utterance).kind == "next"


@pytest.mark.parametrize("utterance", ["回入口", "回到入口", "退回入口", "后退"])
def test_return_directions_move_one_station_toward_entrance(utterance):
    assert interpret(utterance).kind == "previous"


@pytest.mark.parametrize(
    "utterance",
    ["不要往博物馆后面走", "别去里面", "我不想后退", "不用回入口"],
)
def test_negated_directions_do_not_move(utterance):
    assert interpret(utterance) is None


def test_question_about_moving_remains_a_question():
    assert interpret("为什么不往博物馆后面走？") is None
