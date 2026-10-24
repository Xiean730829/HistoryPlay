from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path

from museum.adapters.sqlite.event_repository import SQLiteEventRepository
from museum.adapters.sqlite.receipt_repository import SQLiteReceiptRepository
from museum.adapters.sqlite.session_repository import SQLiteSessionRepository
from museum.ports.command_receipts import CommandReceipts
from museum.ports.event_log import EventLog
from museum.ports.session_store import SessionStore


class SQLiteDatabase:
    """Owns SQLite connections and provides atomic repository transactions."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        if self.path == ":memory:":
            raise ValueError("SQLiteDatabase需要文件路径，以确保事务跨连接持久")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            self._migrate(connection)

    @contextmanager
    def transaction(self) -> Iterator[SQLiteUnitOfWork]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield SQLiteUnitOfWork(connection)
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    @contextmanager
    def read(self) -> Iterator[SQLiteUnitOfWork]:
        """Provides a consistent read snapshot without acquiring the write reservation."""
        connection = self._connect()
        try:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            yield SQLiteUnitOfWork(connection)
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @staticmethod
    def _migrate(connection: sqlite3.Connection) -> None:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > 1:
            raise RuntimeError(f"数据库版本 {version} 高于当前程序支持版本 1")
        if version == 0:
            migration = Path(__file__).parents[4] / "migrations" / "0001_initial.sql"
            connection.executescript(migration.read_text(encoding="utf-8"))


class SQLiteUnitOfWork:
    """Repositories sharing one connection; callers own commit and rollback."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self.sessions: SessionStore = SQLiteSessionRepository(connection)
        self.receipts: CommandReceipts = SQLiteReceiptRepository(connection)
        self.events: EventLog = SQLiteEventRepository(connection)
