# SQLite migrations

`SQLiteDatabase` applies numbered SQL migrations in order and records the current
version in `PRAGMA user_version`. A database created by a newer application is
rejected rather than silently downgraded. Take a consistent copy of the SQLite
file before applying future migrations; migrations are additive and existing
session snapshots remain readable. Content-pack migrations are managed by the
content pipeline and are separate from player-save migrations.
