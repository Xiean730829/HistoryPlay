from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol


class ControlOrchestrator(Protocol):
    async def handle(self, text: str) -> dict[str, Any] | None: ...


class BrowserChannel(Protocol):
    async def send_json(self, data: dict[str, Any]) -> None: ...


RENDER_GATED_ACTIONS = {
    "locate_artifact", "move_next", "move_previous", "return_to_exhibit", "set_view",
    "browse_gallery", "seek_time_range",
}


async def dispatch_local_control(
    orchestrator: ControlOrchestrator, browser: BrowserChannel, text: str,
    before_publish: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any] | None:
    """Dispatch the trusted local action without cancelling the independent cloud reply."""
    result = await orchestrator.handle(text)
    if result is not None:
        if before_publish is not None:
            before_publish(result)
        await browser.send_json({"type": "control", "result": result})
    return result


def render_request_id(control: dict[str, Any] | None) -> str | None:
    if control is None:
        return None
    if control.get("presentation_action") in {"focus_current", "return_to_overview"}:
        request_id = control.get("presentation_request_id")
        return request_id if isinstance(request_id, str) and request_id else None
    receipt = control.get("receipt")
    if not isinstance(receipt, dict) or receipt.get("status") != "committed":
        return None
    if receipt.get("action") not in RENDER_GATED_ACTIONS:
        return None
    request_id = receipt.get("request_id")
    return request_id if isinstance(request_id, str) and request_id else None
