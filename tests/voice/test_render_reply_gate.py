from museum_voice.render_gate import RenderReplyGate


def test_normal_qa_reply_is_not_held_but_navigation_waits_for_exact_rendered_receipt():
    gate = RenderReplyGate()
    assert gate.hold("audio", b"qa", 2) is False
    gate.begin("nav-1")
    assert gate.hold("text", {"type": "tts", "text": "牛"}, 12) is True
    assert gate.hold("audio", b"pcm", 3) is True
    assert gate.resolve("old-nav", "rendered") is None
    assert gate.resolve("nav-1", "rendered") == [
        ("text", {"type": "tts", "text": "牛"}),
        ("audio", b"pcm"),
    ]
    assert gate.hold("audio", b"next", 4) is False


def test_pending_degraded_and_expired_render_never_release_old_voice():
    gate = RenderReplyGate(max_bytes=32)
    gate.begin("nav-1")
    assert gate.hold("audio", b"old", 3)
    assert gate.resolve("nav-1", "pending") is None
    assert gate.resolve("nav-1", "degraded") == []
    assert gate.hold("audio", b"late", 4) is True
    gate.begin("nav-2")
    assert gate.hold("audio", b"late old reply", 14)
    assert gate.expire("nav-2") is True
    assert gate.resolve("nav-2", "rendered") is None
    assert gate.hold("audio", b"late", 4) is True


def test_over_budget_candidate_is_dropped_and_cannot_be_resurrected_by_render_ack():
    gate = RenderReplyGate(max_bytes=4)
    gate.begin("nav-1")
    assert gate.hold("audio", b"12345", 5) is True
    assert gate.resolve("nav-1", "rendered") == []
    assert gate.hold("audio", b"late", 4) is True
