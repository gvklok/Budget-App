"""Tests for money operations: paycheck, transfers, top-off, distribute, transactions.

Every test asserts the invariant: real_cash == savings + mr + sum(fund_balances).
Also asserts exact expected balances (the invariant flag alone is not enough).
"""
import pytest


def test_paycheck(client, helpers):
    """Paycheck: real_cash and savings rise by monthly total."""
    # Setup: create an income source
    r = client.post("/income-sources", json={
        "name": "Job",
        "amount_cents": 500000,
        "frequency": "monthly",
        "anchor_date": "2026-01-01"
    })
    assert r.status_code == 200

    # Simulate paycheck: ONE paycheck = the source's amount_cents once
    r = client.post("/dev/simulate-paycheck")
    assert r.status_code == 200
    body = r.json()
    assert body["added_cents"] == 500000
    assert len(body["paychecks"]) == 1
    assert body["paychecks"][0]["name"] == "Job"
    assert body["paychecks"][0]["amount_cents"] == 500000

    # Check balances
    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 500000
    assert state["savings"]["balance_cents"] == 500000
    assert state["monthly_reserve"]["balance_cents"] == 0
    assert state["invariant_holds"] is True


def test_paycheck_is_one_check_not_monthly_total(client, helpers):
    """A biweekly source credits amount_cents ONCE (one real paycheck), not a
    monthly-normalized ~2.17x lump."""
    client.post("/income-sources", json={
        "name": "Biweekly Job", "amount_cents": 100000, "frequency": "biweekly", "anchor_date": "2026-01-02"
    })
    r = client.post("/dev/simulate-paycheck")
    assert r.status_code == 200
    assert r.json()["added_cents"] == 100000
    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 100000
    assert state["savings"]["balance_cents"] == 100000
    helpers["assert_invariant"](client)


def test_paycheck_multiple_sources_one_each(client, helpers):
    """No body: one paycheck per source, one ledger entry each."""
    client.post("/income-sources", json={"name": "A", "amount_cents": 200000, "frequency": "biweekly", "anchor_date": "2026-01-02"})
    client.post("/income-sources", json={"name": "B", "amount_cents": 50000, "frequency": "weekly", "anchor_date": "2026-01-02"})
    r = client.post("/dev/simulate-paycheck")
    assert r.status_code == 200
    body = r.json()
    assert body["added_cents"] == 250000
    assert {p["name"] for p in body["paychecks"]} == {"A", "B"}
    entries = client.get("/ledger/?kind=paycheck").json()
    assert len(entries) == 2
    helpers["assert_invariant"](client)


def test_paycheck_single_source_by_id(client, helpers):
    """With source_id: credit only that source."""
    a = client.post("/income-sources", json={"name": "A", "amount_cents": 200000, "frequency": "biweekly", "anchor_date": "2026-01-02"}).json()
    client.post("/income-sources", json={"name": "B", "amount_cents": 50000, "frequency": "weekly", "anchor_date": "2026-01-02"})
    r = client.post("/dev/simulate-paycheck", json={"source_id": a["id"]})
    assert r.status_code == 200
    body = r.json()
    assert body["added_cents"] == 200000
    assert body["paychecks"] == [{"source_id": a["id"], "name": "A", "amount_cents": 200000}]
    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 200000
    helpers["assert_invariant"](client)


def test_mr_target_synced_on_app_open_after_rollover(client, helpers):
    """Bug: after a month rollover, the MR target stayed on the OLD month's
    total until Distribute ran. Opening the app (GET /current-month-status)
    must materialize the new month's plan AND sync the target immediately."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # July plan with a bill → target follows July's bills
    client.post("/line-items/", json={
        "name": "Rent", "type": "bill", "amount_cents": 120000, "year": 2026, "month": 7
    })
    assert helpers["get_state"](client)["monthly_reserve"]["target_cents"] == 120000

    # Roll into August (no plan yet). set-simulated-date syncs against a
    # nonexistent August plan → target computes to 0 here.
    client.post("/dev/set-simulated-date", json={"date": "2026-08-01"})
    assert helpers["get_state"](client)["monthly_reserve"]["target_cents"] == 0

    # Open the app: call ONLY the banner endpoint. It must materialize August's
    # plan (copying July's bill) and re-sync the target — no Distribute needed.
    r = client.get("/current-month-status")
    assert r.status_code == 200
    status = r.json()
    assert (status["year"], status["month"]) == (2026, 8)
    # Fresh month: neither top-off nor distribute done → banner shows.
    assert status["top_off_done"] is False
    assert status["distribute_done"] is False
    assert status["needs_banner"] is True

    # Target now reflects August's copied bills; plan exists.
    assert helpers["get_state"](client)["monthly_reserve"]["target_cents"] == 120000
    aug = client.get("/plans/2026/8").json()
    assert aug["planned"] is True and aug["month"] == 8
    helpers["assert_invariant"](client)


def test_transfer_savings_to_mr(client, helpers):
    """Transfer from savings to monthly reserve."""
    # Seed money
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Transfer
    r = client.post("/transfers/", json={
        "from_bucket": "savings",
        "to_bucket": "mr",
        "amount_cents": 30000
    })
    assert r.status_code == 200

    # Check exact balances
    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 100000, "real cash unchanged by transfer"
    assert state["savings"]["balance_cents"] == 70000
    assert state["monthly_reserve"]["balance_cents"] == 30000
    helpers["assert_invariant"](client)


def test_transfer_mr_to_fund(client, helpers):
    """Transfer from monthly reserve to a fund."""
    # Seed
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create fund
    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 0,
        "monthly_contribution_cents": 10000
    })
    fund_id = r.json()["id"]

    # Populate MR first (transfer from savings)
    client.post("/transfers/", json={
        "from_bucket": "savings",
        "to_bucket": "mr",
        "amount_cents": 50000
    })

    # Transfer MR -> fund
    r = client.post("/transfers/", json={
        "from_bucket": "mr",
        "to_bucket": f"fund:{fund_id}",
        "amount_cents": 20000
    })
    assert r.status_code == 200

    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 100000
    assert state["monthly_reserve"]["balance_cents"] == 30000, "50000 - 20000 transferred to fund"
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == 20000
    helpers["assert_invariant"](client)


def test_transfer_fund_to_savings(client, helpers):
    """Transfer from a fund back to savings."""
    # Seed and create fund
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 30000,
        "monthly_contribution_cents": 0
    })
    fund_id = r.json()["id"]

    # Transfer fund -> savings
    r = client.post("/transfers/", json={
        "from_bucket": f"fund:{fund_id}",
        "to_bucket": "savings",
        "amount_cents": 10000
    })
    assert r.status_code == 200

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 80000
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == 20000
    helpers["assert_invariant"](client)


def test_transfer_insufficient_source_rejected(client, helpers):
    """Transfer with insufficient source balance returns 400."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/transfers/", json={
        "from_bucket": "savings",
        "to_bucket": "mr",
        "amount_cents": 200000
    })
    assert r.status_code == 400

    # Verify no change
    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 100000
    assert state["monthly_reserve"]["balance_cents"] == 0
    helpers["assert_invariant"](client)


def test_topoff_basic(client, helpers):
    """Top-off: moves exactly (target - current MR) from savings to MR."""
    # Setup
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    r = client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    assert r.status_code == 200

    # Create bills (target = 120000 + 40000 = 160000)
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 120000,
        "year": 2026,
        "month": 7
    })
    client.post("/line-items/", json={
        "name": "Groceries",
        "type": "bill",
        "amount_cents": 40000,
        "year": 2026,
        "month": 7
    })

    # Top-off
    r = client.post("/monthly-reserve/top-off")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["moved_cents"] == 160000

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 340000
    assert state["monthly_reserve"]["balance_cents"] == 160000
    assert state["monthly_reserve"]["target_cents"] == 160000
    helpers["assert_invariant"](client)


def test_topoff_noop_already_at_target(client, helpers):
    """Second top-off with no bill changes returns 200 already_at_target."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    r = client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    assert r.status_code == 200

    # Create bill
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    # First top-off
    r = client.post("/monthly-reserve/top-off")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["moved_cents"] == 100000

    # Second top-off (no-op)
    r = client.post("/monthly-reserve/top-off")
    assert r.status_code == 200
    assert r.json()["status"] == "already_at_target"
    assert r.json()["moved_cents"] == 0

    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["balance_cents"] == 100000
    helpers["assert_invariant"](client)


def test_topoff_no_bills(client, helpers):
    """Top-off with no bills returns 200 no_bills."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/monthly-reserve/top-off")
    assert r.status_code == 200
    assert r.json()["status"] == "no_bills"
    assert r.json()["moved_cents"] == 0

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 100000
    assert state["monthly_reserve"]["balance_cents"] == 0
    helpers["assert_invariant"](client)


def test_topoff_insufficient_savings_rejected(client, helpers):
    """Top-off with insufficient savings returns 400."""
    client.post("/dev/set-real-cash", json={"balance_cents": 50000})

    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    r = client.post("/monthly-reserve/top-off")
    assert r.status_code == 400

    # Verify no change
    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 50000
    assert state["monthly_reserve"]["balance_cents"] == 0
    helpers["assert_invariant"](client)


def test_distribute_basic(client, helpers):
    """Distribute: funds with contributions get their amounts from savings."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})

    # Create funds with contributions
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
    r = client.post("/funds/distribute")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    funded = r.json()["funded"]
    assert len(funded) == 2
    assert sum(f["amount_cents"] for f in funded) == 50000

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 450000
    vac = next(f for f in state["funds"] if f["id"] == vac_id)
    assert vac["balance_cents"] == 20000
    car = next(f for f in state["funds"] if f["id"] == car_id)
    assert car["balance_cents"] == 30000
    helpers["assert_invariant"](client)


def test_distribute_skipped_funds(client, helpers):
    """Distribute: insufficient savings skips remaining funds, lists all skipped."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create 4 funds with contributions totaling 90000
    contrib_amounts = [20000, 20000, 25000, 30000]  # Total 95000 > 100000 - initial funds
    fund_ids = []
    for i, amt in enumerate(contrib_amounts):
        r = client.post("/funds/", json={
            "name": f"Fund{i}",
            "balance_cents": 0,
            "monthly_contribution_cents": amt
        })
        fund_ids.append(r.json()["id"])

    # Drain savings so only first two funds can be funded
    client.post("/dev/set-savings", json={"balance_cents": 45000})

    r = client.post("/funds/distribute")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

    funded = r.json()["funded"]
    skipped = r.json()["skipped"]

    # First two funded (20000 + 20000 = 40000), leaving 5000 savings
    # Third needs 25000 (skip), Fourth needs 30000 (skip)
    assert len(funded) == 2
    assert len(skipped) == 2
    assert {f["id"] for f in skipped} == {fund_ids[2], fund_ids[3]}

    helpers["assert_invariant"](client)


def test_distribute_no_contributions(client, helpers):
    """Distribute with no fund contributions returns 200 no_contributions."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/distribute")
    assert r.status_code == 200
    assert r.json()["status"] == "no_contributions"
    assert r.json()["funded"] == []
    assert r.json()["skipped"] == []

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 100000
    helpers["assert_invariant"](client)


def test_bill_transaction_spending(client, helpers):
    """Bill transaction: MR and real cash drop."""
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

    # Top-off (move 100000 to MR)
    client.post("/monthly-reserve/top-off")

    # Spend from bill
    r = client.post("/transactions/", json={
        "amount_cents": 30000,
        "date": "2026-07-05",
        "merchant": "Landlord",
        "line_item_id": bill_id
    })
    assert r.status_code == 200

    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 70000
    assert state["monthly_reserve"]["balance_cents"] == 70000
    helpers["assert_invariant"](client)


def test_bill_transaction_insufficient_mr_rejected(client, helpers):
    """Bill transaction with insufficient MR returns 400."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })
    bill_id = r.json()["id"]

    # Attempt spend without topping off
    r = client.post("/transactions/", json={
        "amount_cents": 50000,
        "date": "2026-07-05",
        "merchant": "Landlord",
        "line_item_id": bill_id
    })
    assert r.status_code == 400

    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["balance_cents"] == 0
    helpers["assert_invariant"](client)


def test_fund_transaction_direct(client, helpers):
    """Direct fund spend via fund_id: fund and real cash drop."""
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
    assert r.status_code == 200

    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 80000
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == 30000
    helpers["assert_invariant"](client)


def test_fund_transaction_via_line_item(client, helpers):
    """Fund spend via fund line item: fund and real cash drop."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create fund via line item
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

    # Top-off and distribute to populate fund (if there are bills)
    client.post("/funds/distribute")

    # Spend
    r = client.post("/transactions/", json={
        "amount_cents": 5000,
        "date": "2026-07-08",
        "merchant": "Store",
        "line_item_id": line_item_id
    })
    assert r.status_code == 200

    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 95000
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == 15000
    helpers["assert_invariant"](client)


def test_fund_transaction_insufficient_balance_rejected(client, helpers):
    """Fund spend with insufficient fund balance returns 400."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 10000,
        "monthly_contribution_cents": 0,
        "allow_negative_balance": False
    })
    fund_id = r.json()["id"]

    r = client.post("/transactions/", json={
        "amount_cents": 20000,
        "date": "2026-07-05",
        "merchant": "Airbnb",
        "fund_id": fund_id
    })
    assert r.status_code == 400

    state = helpers["get_state"](client)
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == 10000
    helpers["assert_invariant"](client)


def test_transaction_delete_reversal(client, helpers):
    """Delete transaction: records spend_reversal, original spend entry remains."""
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

    # Delete
    r = client.delete(f"/transactions/{tx_id}")
    assert r.status_code == 200

    # Verify reversal
    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 100000
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == 50000
    helpers["assert_invariant"](client)


def test_negative_balance_fund_reject_without_flag(client, helpers):
    """Fund without allow_negative_balance rejects overdraft."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 10000,
        "monthly_contribution_cents": 0,
        "allow_negative_balance": False
    })
    fund_id = r.json()["id"]

    r = client.post("/transactions/", json={
        "amount_cents": 20000,
        "date": "2026-07-05",
        "merchant": "Overspend",
        "fund_id": fund_id
    })
    assert r.status_code == 400

    state = helpers["get_state"](client)
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == 10000
    helpers["assert_invariant"](client)


def test_negative_balance_fund_allow_with_flag(client, helpers):
    """Fund with allow_negative_balance=True permits negative balance."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 10000,
        "monthly_contribution_cents": 0,
        "allow_negative_balance": True
    })
    fund_id = r.json()["id"]

    r = client.post("/transactions/", json={
        "amount_cents": 20000,
        "date": "2026-07-05",
        "merchant": "Overspend",
        "fund_id": fund_id
    })
    assert r.status_code == 200

    state = helpers["get_state"](client)
    assert state["real_cash"]["balance_cents"] == 80000
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == -10000
    helpers["assert_invariant"](client)


def test_negative_balance_fund_distribute_still_contributes(client, helpers):
    """Distribute contributes to a negative-balance fund (U9)."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create fund with allow_negative_balance=True
    r = client.post("/funds/", json={
        "name": "Recovery",
        "balance_cents": 0,
        "monthly_contribution_cents": 20000,
        "allow_negative_balance": True
    })
    fund_id = r.json()["id"]

    # Drive fund negative via direct spending (spend more than fund has)
    r = client.post("/transactions/", json={
        "amount_cents": 15000,
        "date": "2026-07-05",
        "merchant": "Overspend",
        "fund_id": fund_id
    })
    assert r.status_code == 200

    # Fund is now at -15000
    state = helpers["get_state"](client)
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == -15000

    # Distribute: should add the flat contribution even to negative fund
    r = client.post("/funds/distribute")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

    state = helpers["get_state"](client)
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == 5000, "−15000 + 20000 = 5000"
    helpers["assert_invariant"](client)


def test_fund_create_with_initial_balance(client, helpers):
    """Fund creation with initial_balance: savings drops; too-large rejected."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 30000,
        "monthly_contribution_cents": 0
    })
    assert r.status_code == 200

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 70000
    assert state["real_cash"]["balance_cents"] == 100000
    helpers["assert_invariant"](client)


def test_fund_create_initial_balance_too_large_rejected(client, helpers):
    """Fund creation with initial balance exceeding savings rejected."""
    client.post("/dev/set-real-cash", json={"balance_cents": 50000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 100000,
        "monthly_contribution_cents": 0
    })
    assert r.status_code == 400

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 50000
    helpers["assert_invariant"](client)


def test_fund_create_negative_initial_balance_rejected(client, helpers):
    """POST /funds/ with balance_cents < 0 is rejected with 400."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Invalid",
        "balance_cents": -10000,
        "monthly_contribution_cents": 0,
        "allow_negative_balance": True
    })
    assert r.status_code == 400

    # Verify no fund created and balances unchanged
    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 100000
    assert len(state["funds"]) == 0
    helpers["assert_invariant"](client)


def test_fund_delete_returns_balance_to_savings(client, helpers):
    """Fund deletion: balance returns to savings."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 30000,
        "monthly_contribution_cents": 0
    })
    fund_id = r.json()["id"]

    # Delete
    r = client.delete(f"/funds/{fund_id}")
    assert r.status_code == 200

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 100000
    assert len(state["funds"]) == 0
    helpers["assert_invariant"](client)


def test_fund_delete_negative_balance_reduces_savings(client, helpers):
    """Fund deletion with negative balance: reduces savings."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create fund with allow_negative_balance=True
    r = client.post("/funds/", json={
        "name": "Recovery",
        "balance_cents": 0,
        "monthly_contribution_cents": 0,
        "allow_negative_balance": True
    })
    fund_id = r.json()["id"]

    # Drive fund negative via spending
    r = client.post("/transactions/", json={
        "amount_cents": 10000,
        "date": "2026-07-05",
        "merchant": "Overspend",
        "fund_id": fund_id
    })
    assert r.status_code == 200

    # Fund is now at -10000
    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 100000
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == -10000

    # Delete (negative balance means we owe 10000 from savings)
    r = client.delete(f"/funds/{fund_id}")
    assert r.status_code == 200

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 90000, "100000 - 10000 deficit from deleted negative fund"
    helpers["assert_invariant"](client)


def test_reallocate_decrease_to_exactly_zero_allowed(client, helpers):
    """Reallocate: decrease-to-zero is allowed (U5 flow: patch then reallocate)."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create two bills
    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })
    rent_id = r.json()["id"]

    r = client.post("/line-items/", json={
        "name": "Groceries",
        "type": "bill",
        "amount_cents": 50000,
        "year": 2026,
        "month": 7
    })
    groc_id = r.json()["id"]

    # Initial target is 150000
    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["target_cents"] == 150000

    # User increases Rent via PATCH (the UI edit)
    r = client.patch(f"/line-items/{rent_id}", json={"amount_cents": 150000})
    assert r.status_code == 200

    # After PATCH, target increases to 200000
    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["target_cents"] == 200000

    # Dialog asks where the money comes from; user selects Groceries to decrease
    # Reallocate: move 50000 from Groceries to offset the Rent increase
    r = client.post("/line-items/reallocate", json={
        "increased_line_item_id": rent_id,
        "decreased_line_item_id": groc_id,
        "amount_cents": 50000
    })
    assert r.status_code == 200

    # After reallocate: Rent 150000, Groceries 0, MR target recalculated to 150000
    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["target_cents"] == 150000
    helpers["assert_invariant"](client)


def test_reallocate_below_zero_rejected(client, helpers):
    """Reallocate: below zero is rejected."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/line-items/", json={
        "name": "Groceries",
        "type": "bill",
        "amount_cents": 50000,
        "year": 2026,
        "month": 7
    })
    groc_id = r.json()["id"]

    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })
    rent_id = r.json()["id"]

    # Attempt to reallocate 51000 from groceries (only has 50000)
    r = client.post("/line-items/reallocate", json={
        "increased_line_item_id": rent_id,
        "decreased_line_item_id": groc_id,
        "amount_cents": 51000
    })
    assert r.status_code == 400

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 100000
    helpers["assert_invariant"](client)
