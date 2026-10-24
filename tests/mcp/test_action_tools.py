import asyncio

import pytest
from museum_mcp.action_tools import ActionTools, TrustedInput
from museum_mcp.application_client import GatewayError
from museum_mcp.intent_adapter import interpret


class Client:
    def __init__(self):
        self.submitted = []

    async def state(self):
        return {"camera_pose": {"yaw": 0, "pitch": 0, "zoom": 1}}

    async def get(self, route):
        return {"focused_artifact": {"story_entry_ids": ["cn.tang.story.bull"]}}

    async def voice(self, operation, body, scope):
        self.submitted.append(body)
        return {"status": "committed", "revision": 3}


def test_cloud_get_context_does_not_grant_action_permission():
    client = Client()
    with pytest.raises(GatewayError, match="可信输入"):
        asyncio.run(ActionTools(client).act("next"))
    assert client.submitted == []


def test_bounded_actions_use_existing_commands_and_keep_rendered_separate():
    client = Client()
    tools = ActionTools(client, TrustedInput("bridge-secret", "input-secret"))
    assert asyncio.run(tools.act("back"))["render_status"] == "pending"
    assert client.submitted[-1]["params"]["camera"]["yaw"] == -180
    asyncio.run(tools.act("enter_story"))
    assert client.submitted[-1]["target_id"] == "cn.tang.story.bull"
    asyncio.run(tools.act("next_segment"))
    assert client.submitted[-1]["action"] == "continue_story"


def test_continue_does_not_mean_next_segment_and_last_artifact_wins():
    assert interpret("继续").kind == "resume"
    assert interpret("下一段").kind == "next_segment"
    assert interpret("不要看铜钱了，去看牛").query == "牛"
    assert interpret("介绍一下这个文物").kind == "background"
    assert interpret("普通人也用它吗") is None
