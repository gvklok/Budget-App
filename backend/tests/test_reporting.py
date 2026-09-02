"""Tests for reporting endpoints: monthly-summary, overview, transactions filters.

Verifies that monthly summaries, balance series, and spending breakdowns are correct.
"""
import pytest


def test_monthly_summary_bill_spending(client):
    """Monthly-summary: bill spend counts in actual_spending_cents."""
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

    # Top-off and spend
    client.post("/monthly-reserve/top-off")
    client.post("/transactions/", json={
        "amount_cents": 50000,
        "date": "2026-07-05",
        "merchant": "Landlord",
        "line_item_id": bill_id
    })

    r = client.get("/monthly-summary", params={"year": 2026, "month": 7})
    assert r.status_code == 200
    summary = r.json()
    assert summary["actual_spending_cents"] == 50000


def test_monthly_summary_direct_fund_spending(client):
    """Monthly-summary: direct fund spend counts in actual_spending_cents."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 50000,
        "monthly_contribution_cents": 0
    })
    fund_id = r.json()["id"]

    client.post("/transactions/", json={
        "amount_cents": 20000,
        "date": "2026-07-05",
        "merchant": "Airbnb",
        "fund_id": fund_id
    })

    r = client.get("/monthly-summary", params={"year": 2026, "month": 7})
    assert r.status_code == 200
    summary = r.json()
    assert summary["actual_spending_cents"] == 20000


def test_monthly_summary_fund_line_item_spending(client):
    """Monthly-summary: fund line-item spend counts in actual_spending_cents."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create fund line item (fund created with balance_cents=0 by default)
    r = client.post("/line-items/", json={
        "name": "Groceries",
        "type": "fund",
        "amount_cents": 20000,
        "new_fund_name": "Groceries Fund",
        "year": 2026,
        "month": 7
    })
    line_item_id = r.json()["id"]
    fund_id = r.json()["fund_id"]

    # Fund the fund first (fund creation defaults to balance_cents=0)
    r = client.post("/transfers/", json={
        "from_bucket": "savings",
        "to_bucket": f"fund:{fund_id}",
        "amount_cents": 15000
    })
    assert r.status_code == 200

    # Spend from fund line item
    r = client.post("/transactions/", json={
        "amount_cents": 10000,
        "date": "2026-07-05",
        "merchant": "Store",
        "line_item_id": line_item_id
    })
    assert r.status_code == 200

    r = client.get("/monthly-summary", params={"year": 2026, "month": 7})
    assert r.status_code == 200
    summary = r.json()
    assert summary["actual_spending_cents"] == 10000


def test_monthly_summary_transfer_out_excluded(client):
    """Monthly-summary: transfer_out fund spend goes to transfers_out_cents not actual_spending_cents."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create transfer_out fund
    r = client.post("/funds/", json={
        "name": "Brokerage",
        "balance_cents": 50000,
        "monthly_contribution_cents": 0,
        "destination_type": "transfer_out"
    })
    fund_id = r.json()["id"]

    # Spend from transfer_out fund
    client.post("/transactions/", json={
        "amount_cents": 30000,
        "date": "2026-07-05",
        "merchant": "Investment",
        "fund_id": fund_id
    })

    r = client.get("/monthly-summary", params={"year": 2026, "month": 7})
    assert r.status_code == 200
    summary = r.json()
    assert summary["actual_spending_cents"] == 0
    assert summary["transfers_out_cents"] == 30000


def test_monthly_summary_deleted_transaction_netted(client):
    """Monthly-summary: deleted transaction nets out of spending."""
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

    # Delete the transaction
    client.delete(f"/transactions/{tx_id}")

    r = client.get("/monthly-summary", params={"year": 2026, "month": 7})
    assert r.status_code == 200
    summary = r.json()
    assert summary["actual_spending_cents"] == 0


def test_overview_monthly(client):
    """Overview monthly: income, spent, transfers_out, kept match computation."""
    # Setup: paycheck, top-off, spend, transfer_out
    r = client.post("/income-sources", json={
        "name": "Job",
        "amount_cents": 500000,
        "frequency": "monthly",
        "anchor_date": "2026-01-01"
    })
    client.post("/dev/simulate-paycheck")

    r = client.post("/funds/", json={
        "name": "Brokerage",
        "balance_cents": 0,
        "monthly_contribution_cents": 0,
        "destination_type": "transfer_out"
    })
    brok_id = r.json()["id"]

    # Create a bill and spend
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
        "amount_cents": 100000,
        "date": "2026-07-05",
        "merchant": "Landlord",
        "line_item_id": bill_id
    })

    # Transfer out
    client.post("/transfers/", json={
        "from_bucket": "savings",
        "to_bucket": f"fund:{brok_id}",
        "amount_cents": 50000
    })
    client.post("/transactions/", json={
        "amount_cents": 50000,
        "date": "2026-07-06",
        "merchant": "Investment",
        "fund_id": brok_id
    })

    r = client.get("/overview/monthly?months=2")
    assert r.status_code == 200
    data = r.json()
    months = data["months"]

    jul = next((m for m in months if m["month"] == 7), None)
    assert jul is not None
    assert jul["income_cents"] == 500000
    assert jul["spent_cents"] == 100000
    assert jul["transfers_out_cents"] == 50000


def test_overview_monthly_gap_months(client):
    """Overview monthly: gap months copy from nearest prior plan."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create a bill in July
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    # Jump to September
    client.post("/dev/set-simulated-date", json={"date": "2026-09-10"})

    # August should copy from July
    r = client.get("/plans/2026/8")
    assert r.status_code == 200
    august_plan = r.json()
    assert august_plan["line_items"] != []


def test_transactions_filter_by_fund_id_direct(client):
    """GET /transactions: fund_id filter matches direct fund transactions."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 50000,
        "monthly_contribution_cents": 0
    })
    vac_id = r.json()["id"]

    r = client.post("/transactions/", json={
        "amount_cents": 20000,
        "date": "2026-07-05",
        "merchant": "Airbnb",
        "fund_id": vac_id
    })

    r = client.get(f"/transactions/?fund_id={vac_id}")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 1
    assert txs[0]["fund_id"] == vac_id


def test_transactions_filter_by_fund_id_via_line_item(client):
    """GET /transactions: fund_id filter matches fund line-item transactions."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create fund line item
    r = client.post("/line-items/", json={
        "name": "Groceries",
        "type": "fund",
        "amount_cents": 20000,
        "new_fund_name": "Groceries Fund",
        "year": 2026,
        "month": 7
    })
    line_item_id = r.json()["id"]
    fund_id = r.json()["fund_id"]

    # Fund the fund first
    r = client.post("/transfers/", json={
        "from_bucket": "savings",
        "to_bucket": f"fund:{fund_id}",
        "amount_cents": 10000
    })
    assert r.status_code == 200

    # Spend from line item
    r = client.post("/transactions/", json={
        "amount_cents": 5000,
        "date": "2026-07-05",
        "merchant": "Store",
        "line_item_id": line_item_id
    })
    assert r.status_code == 200

    # Filter by fund_id should match the line item
    r = client.get(f"/transactions/?fund_id={fund_id}")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 1
    assert txs[0]["line_item_id"] == line_item_id


def test_transactions_filter_by_line_item_id(client):
    """GET /transactions: line_item_id filter matches transactions."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

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
        "amount_cents": 50000,
        "date": "2026-07-05",
        "merchant": "Landlord",
        "line_item_id": bill_id
    })

    r = client.get(f"/transactions/?line_item_id={bill_id}")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 1
    assert txs[0]["line_item_id"] == bill_id


def test_transactions_filter_by_year_month(client):
    """GET /transactions: year/month filter matches date range."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 50000,
        "monthly_contribution_cents": 0
    })
    fund_id = r.json()["id"]

    # Transaction in July
    client.post("/transactions/", json={
        "amount_cents": 20000,
        "date": "2026-07-05",
        "merchant": "Airbnb",
        "fund_id": fund_id
    })

    # Filter to July
    r = client.get("/transactions/?year=2026&month=7")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 1

    # Filter to June (empty)
    r = client.get("/transactions/?year=2026&month=6")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 0


def test_transactions_limit(client):
    """GET /transactions: limit parameter works."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 50000,
        "monthly_contribution_cents": 0
    })
    fund_id = r.json()["id"]

    # Create multiple transactions
    for i in range(5):
        client.post("/transactions/", json={
            "amount_cents": 1000,
            "date": f"2026-07-0{i+1}",
            "merchant": f"Store{i}",
            "fund_id": fund_id
        })

    r = client.get("/transactions/?limit=2")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 2


def test_transactions_enriched_line_item_name(client):
    """GET /transactions: response includes line_item_name."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

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
        "amount_cents": 50000,
        "date": "2026-07-05",
        "merchant": "Landlord",
        "line_item_id": bill_id
    })

    r = client.get("/transactions/")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 1
    assert txs[0]["line_item_name"] == "Rent"
    assert txs[0]["fund_name"] is None


def test_transactions_enriched_fund_name_from_line_item(client):
    """GET /transactions: response includes fund_name resolved through line item."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    r = client.post("/line-items/", json={
        "name": "Groceries",
        "type": "fund",
        "amount_cents": 20000,
        "new_fund_name": "Groceries Fund",
        "year": 2026,
        "month": 7
    })
    line_item_id = r.json()["id"]
    fund_id = r.json()["fund_id"]

    # Fund the fund first
    r = client.post("/transfers/", json={
        "from_bucket": "savings",
        "to_bucket": f"fund:{fund_id}",
        "amount_cents": 10000
    })
    assert r.status_code == 200

    r = client.post("/transactions/", json={
        "amount_cents": 5000,
        "date": "2026-07-05",
        "merchant": "Store",
        "line_item_id": line_item_id
    })
    assert r.status_code == 200

    r = client.get("/transactions/")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 1
    assert txs[0]["line_item_name"] == "Groceries"
    assert txs[0]["fund_name"] == "Groceries Fund"


def test_transactions_enriched_fund_name_direct(client):
    """GET /transactions: response includes fund_name for direct fund transactions."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 50000,
        "monthly_contribution_cents": 0
    })
    fund_id = r.json()["id"]

    client.post("/transactions/", json={
        "amount_cents": 20000,
        "date": "2026-07-05",
        "merchant": "Airbnb",
        "fund_id": fund_id
    })

    r = client.get("/transactions/")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 1
    assert txs[0]["fund_name"] == "Vacation"
    assert txs[0]["line_item_name"] is None
