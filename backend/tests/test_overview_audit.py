"""Overview range/consistency audit: new monthly fields and cross-endpoint totals."""
from sqlalchemy import text

from database import SessionLocal, engine
import models


def _setup_july(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    client.post("/income-sources", json={"name": "Job", "amount_cents": 500000, "frequency": "monthly", "anchor_date": "2026-01-01"})
    client.post("/dev/simulate-paycheck")
    a = client.post("/line-items/", json={"name": "Rent", "type": "bill", "amount_cents": 50000, "year": 2026, "month": 7}).json()["id"]
    b = client.post("/line-items/", json={"name": "Phone", "type": "bill", "amount_cents": 50000, "year": 2026, "month": 7}).json()["id"]
    client.post("/monthly-reserve/top-off")
    return a, b


def test_monthly_new_fields_and_no_plan_autocreate(client):
    a, _ = _setup_july(client)
    client.post("/transactions/", json={"amount_cents": 50000, "date": "2026-07-05", "merchant": "L", "line_item_id": a})

    db = SessionLocal()
    before = db.query(models.MonthlyPlan).count()
    db.close()

    rows = client.get("/overview/monthly", params={"months": 3, "year": 2026, "month": 7}).json()["months"]
    assert [(r["year"], r["month"]) for r in rows] == [(2026, 5), (2026, 6), (2026, 7)]
    may, jun, jul = rows
    assert jul["has_plan"] and jul["bills_planned_cents"] == 100000
    assert jul["bills_spent_cents"] == 50000 and jul["bills_over_cents"] == 0
    assert jul["has_activity"] is True
    for r in (may, jun):
        assert r["has_plan"] is False
        assert r["bills_planned_cents"] == 0 and r["bills_over_cents"] == 0
        assert r["has_activity"] is False
        assert r["income_cents"] == 0 and r["spent_cents"] == 0

    db = SessionLocal()
    assert db.query(models.MonthlyPlan).count() == before
    db.close()


def test_monthly_bills_over(client):
    a, b = _setup_july(client)
    client.patch(f"/line-items/{a}", json={"amount_cents": 20000})
    client.post("/transactions/", json={"amount_cents": 30000, "date": "2026-07-05", "merchant": "L", "line_item_id": a})
    jul = client.get("/overview/monthly", params={"months": 1}).json()["months"][0]
    assert jul["bills_spent_cents"] == 30000
    # planned is now 20000 + 50000 = 70000 -> not over; over only when spent > total planned
    assert jul["bills_planned_cents"] == 70000
    assert jul["bills_over_cents"] == 0
    client.post("/transactions/", json={"amount_cents": 50000, "date": "2026-07-06", "merchant": "P", "line_item_id": b})
    jul = client.get("/overview/monthly", params={"months": 1}).json()["months"][0]
    assert jul["bills_spent_cents"] == 80000
    assert jul["bills_over_cents"] == 10000


def test_monthly_rejects_bad_month(client):
    assert client.get("/overview/monthly", params={"year": 2026, "month": 13}).status_code == 400


def test_monthly_summary_counts_unplanned_bill_spend_as_bills(client):
    """A bill spend dated in a month without that bill in its plan is still a bill spend."""
    a, _ = _setup_july(client)
    client.post("/transactions/", json={"amount_cents": 50000, "date": "2026-06-20", "merchant": "L", "line_item_id": a})
    s = client.get("/monthly-summary", params={"year": 2026, "month": 6}).json()
    assert s["bills_spent_cents"] == 50000
    assert s["actual_spending_cents"] == 50000
    m = client.get("/overview/monthly", params={"months": 1, "year": 2026, "month": 6}).json()["months"][0]
    assert m["bills_spent_cents"] == s["bills_spent_cents"]


def test_window_totals_match_breakdown(client):
    a, _ = _setup_july(client)
    client.post("/transactions/", json={"amount_cents": 50000, "date": "2026-07-05", "merchant": "L", "line_item_id": a})
    gone = client.post("/transactions/", json={"amount_cents": 50000, "date": "2026-06-05", "merchant": "x", "line_item_id": a}).json()["id"]
    client.delete(f"/transactions/{gone}")
    client.post("/transactions/", json={"amount_cents": 7000, "date": "2026-06-07", "merchant": "Cash", "from_savings": True, "destination_type": "external_spend"})
    client.post("/transactions/", json={"amount_cents": 9000, "date": "2026-07-08", "merchant": "Fidelity", "from_savings": True, "destination_type": "transfer_out"})
    for n in (1, 3, 6):
        rows = client.get("/overview/monthly", params={"months": n, "year": 2026, "month": 7}).json()["months"]
        assert len(rows) == n
        bd = client.get("/overview/spending-breakdown", params={"months": n, "year": 2026, "month": 7}).json()
        assert sum(r["bills_spent_cents"] for r in rows) == sum(b["spent_cents"] for b in bd["bills"])
        assert sum(r["savings_withdrawals_cents"] for r in rows) == bd["savings_withdrawals_cents"]
        assert sum(r["transfers_out_cents"] for r in rows) == sum(g["amount_cents"] for g in bd["savings_transfers_out"]) + sum(
            f["spent_cents"] for f in bd["funds"] if f["destination_type"] == "transfer_out")
        assert sum(r["funds_spent_cents"] for r in rows) == sum(
            f["spent_cents"] for f in bd["funds"] if f["destination_type"] != "transfer_out")


def test_reused_transaction_id_does_not_skew_reporting(client):
    """Legacy (pre-AUTOINCREMENT) DBs reused the id of a deleted tx; the stale spend/reversal pair must not
    be mistaken for the new tx's, and a reversal nets against the spend it cancels."""
    a, _ = _setup_july(client)
    fund = client.post("/funds/", json={"name": "Fun", "balance_cents": 100000, "monthly_contribution_cents": 0}).json()["id"]
    client.post("/dev/set-real-cash", json={"balance_cents": 10000000})
    t1 = client.post("/transactions/", json={"amount_cents": 14300, "date": "2026-07-04", "fund_id": fund}).json()["id"]
    client.delete(f"/transactions/{t1}")
    # AUTOINCREMENT prevents reuse now; rewind the sequence to recreate legacy-DB history.
    with engine.begin() as conn:
        conn.execute(text("UPDATE sqlite_sequence SET seq = :s WHERE name = 'transactions'"), {"s": t1 - 1})
    t2 = client.post("/transactions/", json={"amount_cents": 3501, "date": "2026-07-07", "merchant": "g", "line_item_id": a}).json()["id"]
    assert t2 == t1  # id reuse is what this test is about
    # still live: classified as a bill by both endpoints
    jul = client.get("/overview/monthly", params={"months": 1}).json()["months"][0]
    assert (jul["bills_spent_cents"], jul["funds_spent_cents"]) == (3501, 0)
    s = client.get("/monthly-summary").json()
    assert (s["bills_spent_cents"], s["actual_spending_cents"]) == (3501, 3501)
    bd = client.get("/overview/spending-breakdown").json()
    assert [b["spent_cents"] for b in bd["bills"]] == [3501] and bd["funds"] == []
    # deleted: nets to zero in the monthly view even though the reversal may name another bucket
    client.delete(f"/transactions/{t2}")
    jul = client.get("/overview/monthly", params={"months": 1}).json()["months"][0]
    assert (jul["bills_spent_cents"], jul["funds_spent_cents"]) == (0, 0)


def test_deleted_fund_spend_reversal_classified_like_spend(client, helpers):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    fund = client.post("/funds/", json={"name": "A", "monthly_contribution_cents": 0}).json()
    client.post("/dev/set-fund-balance", json={"fund_id": fund["id"], "balance_cents": 20000})
    tx = client.post("/transactions/", json={
        "amount_cents": 5000, "date": "2026-07-05", "merchant": "X", "fund_id": fund["id"]}).json()
    assert client.delete(f"/funds/{fund['id']}").status_code == 200
    assert client.delete(f"/transactions/{tx['id']}").status_code == 200

    jul = client.get("/overview/monthly", params={"months": 1, "year": 2026, "month": 7}).json()["months"][0]
    s = client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()
    assert jul["savings_withdrawals_cents"] == 0 and jul["transfers_out_cents"] == 0
    assert s["savings_withdrawals_cents"] == 0 and s["transfers_out_cents"] == 0
    for k_over, k_sum in [("bills_spent_cents", "bills_spent_cents"),
                          ("fund_contributions_cents", "fund_contributions_cents"),
                          ("saved_cents", "saved_cents")]:
        assert jul[k_over] == s[k_sum]
    helpers["assert_invariant"](client)
