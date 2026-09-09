"""Tests for GET /transactions/?include_income — merging real spend
Transactions with paycheck/misc_income LedgerEntry rows into one chronological
feed for the All Transactions page. Read-only reporting; no balance mutation
assertions needed here beyond what dev/reset + the income endpoints already do.
"""


def _make_fund(client, name, balance_cents=0):
    """Assumes the caller has already given Savings enough via /dev/set-real-cash."""
    r = client.post("/funds/", json={
        "name": name,
        "balance_cents": balance_cents,
        "monthly_contribution_cents": 0,
        "allow_negative_balance": False,
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _make_income_source(client, name="RTX", amount_cents=200000):
    r = client.post("/income-sources", json={
        "name": name,
        "amount_cents": amount_cents,
        "frequency": "monthly",
        "anchor_date": "2026-07-01",
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _spend(client, date, amount_cents, fund_id, merchant="Store"):
    r = client.post("/transactions/", json={
        "amount_cents": amount_cents,
        "date": date,
        "merchant": merchant,
        "fund_id": fund_id,
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_include_income_false_matches_prior_shape(client):
    """Omitted / false include_income returns exactly spend rows, each tagged
    kind='spend', with the same fields as before."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_id = _make_fund(client, "Gabe's Fund", balance_cents=10000)
    _spend(client, "2026-07-05", 500, fund_id, merchant="Coffee")

    r = client.get("/transactions/")
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["kind"] == "spend"
    assert rows[0]["merchant"] == "Coffee"
    assert rows[0]["amount_cents"] == 500

    # Explicit false behaves identically.
    r2 = client.get("/transactions/", params={"include_income": False})
    assert r2.json() == rows


def test_include_income_true_merges_paycheck_and_misc_income(client):
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_id = _make_fund(client, "Gabe's Fund", balance_cents=10000)
    source_id = _make_income_source(client)

    _spend(client, "2026-07-10", 500, fund_id, merchant="Coffee")

    # log_paycheck stamps the ledger entry with today's effective date (it takes
    # no date param), so pin the simulated clock to control ordering.
    r = client.post("/dev/set-simulated-date", json={"date": "2026-07-11"})
    assert r.status_code == 200, r.text
    r = client.post("/paycheck", json={"source_id": source_id})
    assert r.status_code == 200, r.text
    r = client.post("/income/misc", json={
        "amount_cents": 2500, "label": "Birthday gift", "date": "2026-07-12",
    })
    assert r.status_code == 200, r.text

    r = client.get("/transactions/", params={"include_income": True})
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 3

    kinds = {row["kind"] for row in rows}
    assert kinds == {"spend", "paycheck", "misc_income"}

    paycheck_row = next(row for row in rows if row["kind"] == "paycheck")
    assert paycheck_row["merchant"] == "RTX"
    assert paycheck_row["line_item_id"] is None
    assert paycheck_row["fund_id"] is None
    assert paycheck_row["destination_type"] is None
    assert paycheck_row["source"] == "manual"
    assert paycheck_row["status"] == "posted"
    assert paycheck_row["date"] == "2026-07-11"

    misc_row = next(row for row in rows if row["kind"] == "misc_income")
    assert misc_row["merchant"] == "Birthday gift"
    assert misc_row["amount_cents"] == 2500

    # Sorted by date descending: misc income (07-12) first, spend (07-10) last.
    dates = [row["date"] for row in rows]
    assert dates == sorted(dates, reverse=True)
    assert dates[0] == "2026-07-12"
    assert dates[-1] == "2026-07-10"


def test_include_income_ignored_when_bucket_scoped(client):
    """fund_id / line_item_id scoping means income (not tied to a bucket) is
    never mixed in, regardless of the flag."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_id = _make_fund(client, "Gabe's Fund", balance_cents=10000)
    other_fund_id = _make_fund(client, "Other Fund", balance_cents=10000)
    source_id = _make_income_source(client)

    _spend(client, "2026-07-10", 500, fund_id, merchant="Coffee")
    _spend(client, "2026-07-11", 700, other_fund_id, merchant="Snacks")
    client.post("/paycheck", json={"source_id": source_id})

    r = client.get("/transactions/", params={"include_income": True, "fund_id": fund_id})
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["kind"] == "spend"
    assert rows[0]["merchant"] == "Coffee"


def test_include_income_limit_applies_to_merged_set(client):
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_id = _make_fund(client, "Gabe's Fund", balance_cents=10000)
    source_id = _make_income_source(client)

    _spend(client, "2026-07-01", 500, fund_id, merchant="Old spend")
    r = client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    assert r.status_code == 200, r.text
    r = client.post("/paycheck", json={"source_id": source_id})
    assert r.status_code == 200, r.text
    r = client.post("/income/misc", json={
        "amount_cents": 2500, "label": "Birthday gift", "date": "2026-07-20",
    })
    assert r.status_code == 200, r.text
    _spend(client, "2026-07-15", 600, fund_id, merchant="Newer spend")

    r = client.get("/transactions/", params={"include_income": True, "limit": 2})
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 2
    dates = [row["date"] for row in rows]
    assert dates == sorted(dates, reverse=True)
    # Top 2 by date across the merged set should NOT include the oldest spend.
    assert all(row["merchant"] != "Old spend" for row in rows)
