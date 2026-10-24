from __future__ import annotations

from contextlib import AbstractContextManager
from typing import Protocol

from museum.ports.command_receipts import CommandReceipts
from museum.ports.event_log import EventLog
from museum.ports.session_store import SessionStore


class UnitOfWork(Protocol):
    sessions: SessionStore
    receipts: CommandReceipts
    events: EventLog


class TransactionFactory(Protocol):
    def __call__(self) -> AbstractContextManager[UnitOfWork]: ...
