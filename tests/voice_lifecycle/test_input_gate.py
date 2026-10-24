from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from museum.application.voice_lifecycle import StaleVoiceInput, VoiceLifecycle


def fixture():
    state = SimpleNamespace(revision=3, view_revision=2, interaction_epoch=4)

    class Database:
        @contextmanager
        def read(self):
            yield SimpleNamespace(sessions=SimpleNamespace(get=lambda _: state))

    class Bindings:
        def require_active(self, session, actor):
            if actor != "page":
                raise StaleVoiceInput("旧页面")

    submitted = []

    class Commands:
        def execute(self, session, actor, payload):
            submitted.append(payload)
            return SimpleNamespace(to_dict=lambda: {"status": "committed", "revision": 4})

    tickets = SimpleNamespace(issue=lambda **kwargs: "private-control-ticket")
    clock = [0]
    gate = VoiceLifecycle(Database(), Commands(), Bindings(), tickets, clock=lambda: clock[0])
    bridge = gate.bind("session", "page")
    return gate, bridge, submitted, state, clock


def test_late_old_input_cannot_regain_permission_by_reading_new_state():
    gate, bridge, submitted, state, _ = fixture()
    old = gate.begin("session", "page", bridge)
    state.revision = 100
    current = gate.begin("session", "page", bridge)
    with pytest.raises(StaleVoiceInput):
        gate.execute("session", "page", bridge, old, "move_next")
    gate.execute("session", "page", bridge, current, "move_previous")
    assert len(submitted) == 1
    assert submitted[0]["expected_revision"] == 100


def test_one_input_is_one_shot_and_versions_cannot_be_refreshed_after_begin():
    gate, bridge, submitted, state, _ = fixture()
    token = gate.begin("session", "page", bridge)
    state.revision = 99
    gate.execute("session", "page", bridge, token, "move_next")
    assert submitted[0]["expected_revision"] == 3
    assert submitted[0]["interaction_epoch"] == 4
    with pytest.raises(StaleVoiceInput):
        gate.execute("session", "page", bridge, token, "move_next")


def test_cancel_expiry_rebinding_and_fake_source_are_rejected():
    gate, bridge, _, _, clock = fixture()
    token = gate.begin("session", "page", bridge)
    gate.cancel("session", "page", bridge, token)
    with pytest.raises(StaleVoiceInput):
        gate.execute("session", "page", bridge, token, "move_next")
    token = gate.begin("session", "page", bridge)
    clock[0] = 91
    with pytest.raises(StaleVoiceInput):
        gate.execute("session", "page", bridge, token, "move_next")
    gate.bind("session", "page")
    with pytest.raises(StaleVoiceInput):
        gate.begin("session", "page", bridge)
    with pytest.raises(StaleVoiceInput):
        gate.begin("session", "cloud-model", bridge)
