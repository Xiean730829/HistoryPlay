import asyncio

from museum_voice.control_flow import dispatch_local_control, render_request_id


class Browser:
    def __init__(self):
        self.events = []

    async def send_json(self, data):
        self.events.append(data)


class Orchestrator:
    def __init__(self, result):
        self.result = result

    async def handle(self, _text):
        return self.result


class Upstream:
    def __init__(self):
        self.events = []

    async def send_json(self, data):
        self.events.append(data)


def test_local_navigation_dispatch_does_not_abort_the_cloud_voice_reply():
    async def run():
        browser = Browser()
        upstream = Upstream()
        result = {"kind": "action", "receipt": {
            "status": "committed", "action": "locate_artifact", "request_id": "nav-1",
        }}
        control = await dispatch_local_control(Orchestrator(result), browser, "看牛")
        assert render_request_id(control) == "nav-1"
        assert browser.events == [{"type": "control", "result": result}]
        # dispatch_local_control has no upstream handle; only the explicit browser abort path can retire it.
        assert upstream.events == []

    asyncio.run(run())


def test_question_or_noncommitted_action_does_not_wait_for_render():
    assert render_request_id(None) is None
    assert render_request_id({"kind": "qa"}) is None
    assert render_request_id({"receipt": {"status": "rejected", "action": "locate_artifact"}}) is None
    assert render_request_id({"receipt": {"status": "committed", "action": "enter_story", "request_id": "story"}}) is None
    assert render_request_id({"receipt": {"status": "rejected", "action": "locate_artifact", "request_id": "same-focus"}}) is None
    assert render_request_id({"receipt": {"status": "committed", "action": "set_view", "request_id": "view-1"}}) == "view-1"
    assert render_request_id({"presentation_action": "return_to_overview", "presentation_request_id": "local-view-1"}) == "local-view-1"
    assert render_request_id({"presentation_action": "focus_current", "presentation_request_id": "local-focus-1"}) == "local-focus-1"


def test_gate_is_armed_before_browser_can_acknowledge_a_fast_render():
    from museum_voice.render_gate import RenderReplyGate

    async def run():
        gate = RenderReplyGate()
        result = {"kind": "action", "receipt": {
            "status": "committed", "action": "locate_artifact", "request_id": "coin-view",
        }}

        class FastBrowser:
            async def send_json(self, data):
                assert gate.request_id == "coin-view"
                assert gate.resolve("coin-view", "rendered") == []

        await dispatch_local_control(
            Orchestrator(result), FastBrowser(), "看铜钱",
            lambda control: gate.begin(render_request_id(control)),
        )
        assert gate.request_id is None
        assert not gate.drop

    asyncio.run(run())
