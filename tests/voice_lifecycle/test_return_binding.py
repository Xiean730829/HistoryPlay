from __future__ import annotations

from museum.application.binding_service import BindingService
from museum.application.control_tickets import ControlTickets


def test_web_pair_ticket_authorizes_return_from_story_to_exhibit() -> None:
    tickets = ControlTickets()
    bindings = BindingService(tickets)
    binding = bindings.pair("session-1")

    tickets.validate(
        binding.control_ticket,
        session_id=binding.session_id,
        actor_id=binding.connection_id,
        action="return_to_exhibit",
    )
