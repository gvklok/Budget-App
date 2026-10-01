"""transactions must be AUTOINCREMENT so ids are never reused (ledger_entries
.transaction_id is a plain int). _migrate rebuilds legacy tables in place and
seeds sqlite_sequence past every id the ledger has ever referenced."""
import os
import tempfile

import pytest
from sqlalchemy import create_engine, event, text

import main
import models

LEGACY_TX_DDL = """
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    amount_cents INTEGER NOT NULL,
    date TEXT NOT NULL,
    merchant TEXT,
    line_item_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
    fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL,
    created_at DATETIME,
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    status TEXT NOT NULL DEFAULT 'posted',
    line_item_name TEXT,
    destination_type TEXT
, from_savings BOOLEAN NOT NULL DEFAULT 0)
"""


def _engine(path):
    eng = create_engine(f"sqlite:///{path}")

    @event.listens_for(eng, "connect")
    def _fk(dbapi_conn, _record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    return eng


@pytest.fixture
def scratch_engine(monkeypatch):
    path = os.path.join(tempfile.mkdtemp(), "mig.db")
    eng = _engine(path)
    monkeypatch.setattr(main, "engine", eng)
    yield eng
    eng.dispose()


def _rows(conn):
    return conn.execute(text("SELECT * FROM transactions ORDER BY id")).fetchall()


def _seq(conn):
    return conn.execute(text(
        "SELECT seq FROM sqlite_sequence WHERE name = 'transactions'")).scalar()


def _tx_sql(conn):
    return conn.execute(text(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'")).scalar()


def _insert_tx(conn, amount=100):
    return conn.execute(text(
        "INSERT INTO transactions (amount_cents, date, source, status, from_savings) "
        "VALUES (:a, '2026-07-01', 'manual', 'posted', 0)"),
        {"a": amount}).lastrowid


def _build_legacy(eng):
    tables = [t for t in models.Base.metadata.sorted_tables if t.name != "transactions"]
    models.Base.metadata.create_all(eng, tables=tables)
    with eng.begin() as conn:
        conn.execute(text(LEGACY_TX_DDL))
        conn.execute(text(
            "CREATE UNIQUE INDEX ix_transactions_source_external_id "
            "ON transactions (source, external_id) WHERE external_id IS NOT NULL"))
        conn.execute(text("INSERT INTO funds (id, name, balance_cents, monthly_contribution_cents, destination_type, allow_negative_balance, sort_order) VALUES (1, 'Travel', 0, 0, 'external_spend', 0, 0)"))
        conn.execute(text("""
            INSERT INTO transactions (id, amount_cents, date, merchant, fund_id, created_at,
                source, external_id, status, line_item_name, destination_type, from_savings)
            VALUES
                (1, 1500, '2026-07-01', 'Cafe', 1, '2026-07-01 10:00:00', 'manual', NULL,
                 'posted', NULL, 'external_spend', 0),
                (3, 2500, '2026-07-02', 'Vet', NULL, '2026-07-02 10:00:00', 'bank', 'ext-1',
                 'pending', 'Pets', 'transfer_out', 1),
                (5, 999, '2026-07-03', NULL, NULL, NULL, 'manual', NULL, 'posted', NULL, NULL, 0)
        """))
        # Ledger history references tx 9, which was deleted (and would be reused).
        conn.execute(text("""
            INSERT INTO ledger_entries (kind, amount_cents, from_bucket, to_bucket, transaction_id, date)
            VALUES ('spend', 4000, 'mr', NULL, 9, '2026-07-04'),
                   ('spend_reversal', 4000, NULL, 'mr', 9, '2026-07-04')
        """))
        assert "sqlite_sequence" not in {r[0] for r in conn.execute(
            text("SELECT name FROM sqlite_master WHERE type = 'table'"))}


def test_legacy_migration_preserves_rows_and_never_reuses_ids(scratch_engine):
    _build_legacy(scratch_engine)
    with scratch_engine.connect() as conn:
        before = _rows(conn)

    main._migrate()

    with scratch_engine.begin() as conn:
        assert "AUTOINCREMENT" in _tx_sql(conn).upper()
        assert _rows(conn) == before
        assert _seq(conn) >= 9
        idx = conn.execute(text(
            "SELECT sql FROM sqlite_master WHERE type = 'index' "
            "AND name = 'ix_transactions_source_external_id'")).scalar()
        assert "WHERE external_id IS NOT NULL" in idx
        fks = {fk[3]: fk[6] for fk in conn.execute(text("PRAGMA foreign_key_list(transactions)"))}
        assert fks == {"line_item_id": "SET NULL", "fund_id": "SET NULL"}
        assert conn.execute(text("PRAGMA integrity_check")).scalar() == "ok"
        assert conn.execute(text("PRAGMA foreign_key_check")).fetchall() == []

        a = _insert_tx(conn)
        assert a == 10, "first new id must clear the ledger's max transaction_id"
        conn.execute(text("DELETE FROM transactions WHERE id = :i"), {"i": a})
        b = _insert_tx(conn)
        assert b == a + 1, "deleted max id must not be reused"


def test_second_migrate_is_noop(scratch_engine):
    _build_legacy(scratch_engine)
    main._migrate()
    with scratch_engine.connect() as conn:
        sql1, rows1, seq1 = _tx_sql(conn), _rows(conn), _seq(conn)
    main._migrate()
    with scratch_engine.connect() as conn:
        assert (_tx_sql(conn), _rows(conn), _seq(conn)) == (sql1, rows1, seq1)
        assert conn.execute(text(
            "SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'transactions'")).scalar() == 1


def test_fresh_db_create_all_path(scratch_engine):
    models.Base.metadata.create_all(scratch_engine)
    with scratch_engine.connect() as conn:
        sql_before = _tx_sql(conn)
    assert "AUTOINCREMENT" in sql_before.upper()

    main._migrate()
    main._migrate()

    with scratch_engine.begin() as conn:
        assert _tx_sql(conn) == sql_before  # no rebuild needed
        assert _seq(conn) == 0
        a = _insert_tx(conn)
        conn.execute(text("DELETE FROM transactions WHERE id = :i"), {"i": a})
        assert _insert_tx(conn) == a + 1


def test_seq_never_lowered(scratch_engine):
    models.Base.metadata.create_all(scratch_engine)
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO sqlite_sequence (name, seq) VALUES ('transactions', 50)"))
    main._migrate()
    with scratch_engine.connect() as conn:
        assert _seq(conn) == 50


def test_app_never_reuses_deleted_tx_id(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 100000})
    f = client.post("/funds/", json={"name": "Travel", "monthly_contribution_cents": 0}).json()
    client.post("/dev/set-fund-balance", json={"fund_id": f["id"], "balance_cents": 50000})
    spend = {"date": "2026-07-13", "fund_id": f["id"], "amount_cents": 1000}
    old = client.post("/transactions/", json=spend).json()
    assert client.delete(f"/transactions/{old['id']}").status_code == 200
    new = client.post("/transactions/", json=spend).json()
    assert new["id"] > old["id"]
