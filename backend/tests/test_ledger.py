"""Tests for ledger entries and fund detail endpoints.

Verifies that each operation writes the expected ledger entry kind/amount/buckets.
"""


def test_ledger_paycheck_entry(client):
    """Paycheck creates a ledger entry."""
    # Setup income source
    client.post("/income-sources", json={
        "name": "Job",
        "amount_cents": 500000,
        "frequency": "monthly"
    })

    # Simulate paycheck
    r = client.post("/dev/simulate-paycheck")
    assert r.status_code == 200

    # Check ledger
    r = client.get("/ledger/")
    assert r.status_code == 200
    entries = r.json()
    paycheck = next((e for e in entries if e["kind"] == "paycheck"), None)
    assert paycheck is not None
    assert paycheck["from_bucket"] == "external"
    assert paycheck["to_bucket"] == "savings"
    assert paycheck["amount_cents"] == 500000
    assert paycheck["label"] == "Paycheck"


def test_ledger_top_off_entry(client):
    """Top-off creates a ledger entry."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create bill
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    # Top-off
    client.post("/monthly-reserve/top-off")

    # Check ledger
    r = client.get("/ledger/")
    entries = r.json()
    top_off = next((e for e in entries if e["kind"] == "top_off"), None)
    assert top_off is not None
    assert top_off["from_bucket"] == "savings"
    assert top_off["to_bucket"] == "mr"
    assert top_off["amount_cents"] == 100000


def test_ledger_distribute_entries(client):
    """Distribute creates entries for each funded fund."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create funds
    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 0,
        "monthly_contribution_cents": 20000
    })
    vac_id = r.json()["id"]

    r = client.post("/funds/", json={
        "name": "Car",
        "balance_cents": 0,
        "monthly_contribution_cents": 30000
    })
    car_id = r.json()["id"]

    # Distribute
    client.post("/funds/distribute")

    # Check ledger
    r = client.get("/ledger/")
    entries = r.json()
    dist = [e for e in entries if e["kind"] == "distribute"]
    assert len(dist) == 2
    assert {e["label"] for e in dist} == {"Vacation", "Car"}
    assert all(e["from_bucket"] == "savings" for e in dist)
    assert all(e["to_bucket"].startswith("fund:") for e in dist)


def test_ledger_spend_entry(client):
    """Transaction creates a spend ledger entry."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create bill
    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })
    bill_id = r.json()["id"]

    # Top-off
    client.post("/monthly-reserve/top-off")

    # Spend
    r = client.post("/transactions/", json={
        "amount_cents": 50000,
        "date": "2026-07-05",
        "merchant": "Landlord",
        "line_item_id": bill_id
    })
    tx_id = r.json()["id"]

    # Check ledger
    r = client.get("/ledger/")
    entries = r.json()
    spend = next((e for e in entries if e["kind"] == "spend" and e["transaction_id"] == tx_id), None)
    assert spend is not None
    assert spend["from_bucket"] == "mr"
    assert spend["to_bucket"] == "external"
    assert spend["amount_cents"] == 50000
    assert spend["label"] == "Landlord"
    assert spend["date"] == "2026-07-05"


def test_ledger_spend_reversal_entry(client):
    """Delete transaction appends a spend_reversal entry."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 50000,
        "monthly_contribution_cents": 0
    })
    fund_id = r.json()["id"]

    r = client.post("/transactions/", json={
        "amount_cents": 20000,
        "date": "2026-07-05",
        "merchant": "Airbnb",
        "fund_id": fund_id
    })
    tx_id = r.json()["id"]

    # Delete transaction
    client.delete(f"/transactions/{tx_id}")

    # Check ledger: original spend and reversal both present (append-only)
    r = client.get("/ledger/")
    entries = r.json()
    spends = [e for e in entries if e["kind"] == "spend" and e["transaction_id"] == tx_id]
    reversals = [e for e in entries if e["kind"] == "spend_reversal" and e["transaction_id"] == tx_id]

    assert len(spends) == 1, "Original spend entry must survive deletion"
    assert len(reversals) == 1, "Reversal entry must be created"
    assert reversals[0]["date"] == "2026-07-05"


def test_ledger_transfer_entry(client):
    """Transfer creates a ledger entry."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    client.post("/transfers/", json={
        "from_bucket": "savings",
        "to_bucket": "mr",
        "amount_cents": 30000
    })

    r = client.get("/ledger/")
    entries = r.json()
    transfer = next((e for e in entries if e["kind"] == "transfer"), None)
    assert transfer is not None
    assert transfer["from_bucket"] == "savings"
    assert transfer["to_bucket"] == "mr"
    assert transfer["amount_cents"] == 30000


def test_ledger_adjustment_entries(client):
    """Dev reset setters create adjustment entries."""
    client.post("/dev/set-real-cash", json={"balance_cents": 50000})
    client.post("/dev/set-savings", json={"balance_cents": 30000})

    r = client.get("/ledger/")
    entries = r.json()
    adj = [e for e in entries if e["kind"] == "adjustment"]
    assert len(adj) >= 2, "Should have at least 2 adjustment entries"


def test_ledger_filters_by_bucket(client):
    """GET /ledger/ filters by bucket parameter."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 0,
        "monthly_contribution_cents": 20000
    })
    fund_id = r.json()["id"]

    client.post("/funds/distribute")

    # Filter by fund bucket
    r = client.get(f"/ledger/?bucket=fund:{fund_id}")
    assert r.status_code == 200
    entries = r.json()
    assert all(e["to_bucket"] == f"fund:{fund_id}" or e["from_bucket"] == f"fund:{fund_id}" for e in entries)


def test_ledger_filters_by_kind(client):
    """GET /ledger/ filters by kind parameter."""
    client.post("/income-sources", json={
        "name": "Job",
        "amount_cents": 500000,
        "frequency": "monthly"
    })
    client.post("/dev/simulate-paycheck")

    r = client.get("/ledger/?kind=paycheck")
    assert r.status_code == 200
    entries = r.json()
    assert all(e["kind"] == "paycheck" for e in entries)
    assert len(entries) == 1


def test_ledger_filters_by_year_month(client):
    """GET /ledger/ filters by year and month parameters."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create and spend in July
    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })
    bill_id = r.json()["id"]

    client.post("/monthly-reserve/top-off")
    client.post("/transactions/", json={
        "amount_cents": 30000,
        "date": "2026-07-05",
        "merchant": "Landlord",
        "line_item_id": bill_id
    })

    # Filter to July
    r = client.get("/ledger/?year=2026&month=7")
    entries = r.json()
    assert len(entries) > 0
    assert all(e["date"].startswith("2026-07") for e in entries)

    # Filter to June (empty)
    r = client.get("/ledger/?year=2026&month=6")
    entries = r.json()
    assert entries == []


def test_ledger_limit_parameter(client):
    """GET /ledger/ respects limit parameter."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create multiple entries
    for i in range(5):
        client.post("/dev/set-savings", json={"balance_cents": 100000 - i * 1000})

    r = client.get("/ledger/?limit=3")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 3


def test_fund_detail_balance_series(client):
    """Fund detail: balance_series has correct newest point."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 30000,
        "monthly_contribution_cents": 20000
    })
    fund_id = r.json()["id"]

    # Distribute to add more
    client.post("/funds/distribute")

    r = client.get(f"/funds/{fund_id}/detail")
    assert r.status_code == 200
    detail = r.json()

    series = detail["balance_series"]
    assert len(series) > 0
    assert series[-1]["balance_cents"] == 50000, "Newest point == current balance"


def test_fund_detail_activity(client):
    """Fund detail: activity contains relevant ledger entries."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 30000,
        "monthly_contribution_cents": 20000
    })
    fund_id = r.json()["id"]

    # Distribute
    client.post("/funds/distribute")

    # Spend from fund
    r = client.post("/transactions/", json={
        "amount_cents": 10000,
        "date": "2026-07-05",
        "merchant": "Airbnb",
        "fund_id": fund_id
    })

    r = client.get(f"/funds/{fund_id}/detail")
    assert r.status_code == 200
    detail = r.json()
    activity = detail["activity"]

    kinds = [e["kind"] for e in activity]
    assert "distribute" in kinds or "transfer" in kinds, "Should have fund-related entries"


def test_fund_detail_missing_fund_404(client):
    """GET /funds/{id}/detail for missing fund returns 404."""
    r = client.get("/funds/9999/detail")
    assert r.status_code == 404


def test_dev_reset_clears_ledger(client):
    """POST /dev/reset clears all ledger entries."""
    client.post("/dev/set-real-cash", json={"balance_cents": 50000})
    client.post("/dev/set-savings", json={"balance_cents": 30000})

    r = client.get("/ledger/")
    entries_before = r.json()
    assert len(entries_before) > 0

    # Reset
    client.post("/dev/reset")

    r = client.get("/ledger/")
    entries_after = r.json()
    assert entries_after == []
