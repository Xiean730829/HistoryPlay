import asyncio
from types import SimpleNamespace

from museum_voice import game_binding


def test_new_display_cancels_old_input_and_socket_before_becoming_current(monkeypatch):
    async def run():
        events = []

        class Client:
            def __init__(self, binding, *, origin):
                self.binding = binding

            async def voice(self, operation):
                return {"bridge_token": "new-bridge-token"}

        monkeypatch.setattr(game_binding, "VoiceApplicationClient", Client)

        async def cancel_old():
            events.append("cancel-old-input")

        async def close_old():
            events.append("close-old-audio")

        previous = SimpleNamespace(cancel_input=cancel_old)
        old_socket = SimpleNamespace(close=close_old)
        # Use a list for the fake app; production has a set of real WS objects.
        app = {
            game_binding.GAME_BINDINGS: {"old": previous},
            game_binding.ACTIVE_AUDIO: [old_socket],
        }

        class Request:
            def __init__(self):
                self.headers = {"Origin": "http://127.0.0.1:5174"}

            async def json(self):
                return {
                    "base_url": "http://127.0.0.1:8781",
                    "session_id": "new-session",
                    "session_token": "private-token",
                    "connection_id": "new-page",
                }

        request = Request()
        request.app = app
        result = await game_binding.bind_game(request)
        assert result.status == 200
        assert events == ["cancel-old-input", "close-old-audio"]
        assert "old" not in app[game_binding.GAME_BINDINGS]
        assert len(app[game_binding.GAME_BINDINGS]) == 1
        current = next(iter(app[game_binding.GAME_BINDINGS].values()))
        assert current.client.binding.session_id == "new-session"

    asyncio.run(run())
