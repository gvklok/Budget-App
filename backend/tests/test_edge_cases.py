"""Edge-case regressions from the deleted-bucket / bank-sync audit.

Core theme: deleting a transaction must reverse against the ORIGINAL spend's
ledger entry (not the tx's current, possibly-mutated pointers), and every
reporting surface must keep counting orphaned spends. The invariant
(Real Cash == Savings + MR + Σ Funds) must survive all of it.
"""


def _ledger(client):
    r = client.get("/ledger/")
    assert r.status_code == 200, r.text
    return r.json()


def _reversal(client, tx_id):
    entries = [
        e for e in _ledger(client)
        if e["kind"] == "spend_reversal" and e["transaction_id"] == tx_id
    ]
    assert len(entries) == 1, f"expected exactly one reversal for tx {tx_id}"
    return entries[0]


def test_delete_tx_after_fund_deleted_credits_savings(client, helpers):
    """Fund deleted after a spend: deleting the tx follows the money to Savings
    (where the fund's balance was swept), keeps the invariant, and the reversal
    ledger entry's to_bucket is 'savings'."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})

    fund = client.post("/funds/", json={
        "name": "Vacation", "monthly_contribution_cents": 0,
        "balance_cents": 80000, "destination_type": "external_spend",
    }).json()
    tx = client.post("/transactions/", json={
        "fund_id": fund["id"], "amount_cents": 20000, "date": "2026-07-15",
        "merchant": "Hotel",
    }).json()

    assert client.delete(f"/funds/{fund['id']}").status_code == 200
    helpers["assert_invariant"](client)

    savings_before = helpers["get_state"](client)["savings"]["balance_cents"]
    assert client.delete(f"/transactions/{tx['id']}").status_code == 200

    helpers["assert_invariant"](client)
    savings_after = helpers["get_state"](client)["savings"]["balance_cents"]
    assert savings_after == savings_before + 20000

    rev = _reversal(client, tx["id"])
    assert rev["to_bucket"] == "savings"
    assert "(fund deleted)" in (rev["label"] or "")


def test_delete_tx_after_bill_line_item_deleted(client, helpers):
    """Bill line item deleted after a spend: deleting the orphaned tx credits MR
    (the original bucket) and the invariant holds."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})

    bill = client.post("/line-items/", json={
        "name": "Rent", "type": "bill", "amount_cents": 200000,
        "year": 2026, "month": 7,
    }).json()
    client.post("/monthly-reserve/top-off")
    tx = client.post("/transactions/", json={
        "line_item_id": bill["id"], "amount_cents": 50000, "date": "2026-07-15",
    }).json()

    assert client.delete(f"/line-items/{bill['id']}").status_code == 200
    helpers["assert_invariant"](client)

    mr_before = helpers["get_state"](client)["monthly_reserve"]["balance_cents"]
    assert client.delete(f"/transactions/{tx['id']}").status_code == 200

    helpers["assert_invariant"](client)
    mr_after = helpers["get_state"](client)["monthly_reserve"]["balance_cents"]
    assert mr_after == mr_before + 50000
    assert _reversal(client, tx["id"])["to_bucket"] == "mr"


def test_bill_to_fund_type_change_then_delete_credits_mr(client, helpers):
    """A bill spend, then the line item is retyped bill->fund. Deleting the tx
    must credit MR (the ORIGINAL bucket), never the newly-linked fund."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})

    bill = client.post("/line-items/", json={
        "name": "Groceries", "type": "bill", "amount_cents": 100000,
        "year": 2026, "month": 7,
    }).json()
    client.post("/monthly-reserve/top-off")
    fund = client.post("/funds/", json={
        "name": "Vacation", "monthly_contribution_cents": 0,
        "balance_cents": 0, "destination_type": "external_spend",
    }).json()
    tx = client.post("/transactions/", json={
        "line_item_id": bill["id"], "amount_cents": 30000, "date": "2026-07-15",
    }).json()

    assert client.patch(f"/line-items/{bill['id']}", json={
        "type": "fund", "fund_id": fund["id"],
    }).status_code == 200

    assert client.delete(f"/transactions/{tx['id']}").status_code == 200

    helpers["assert_invariant"](client)
    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["balance_cents"] == 100000  # MR fully restored
    assert state["funds"][0]["balance_cents"] == 0  # fund untouched
    assert _reversal(client, tx["id"])["to_bucket"] == "mr"


def test_fund_repoint_then_delete_credits_original_fund(client, helpers):
    """A fund line-item spend, then its fund_id is repointed to another fund.
    Deleting the tx must credit the ORIGINAL fund."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})

    fund_a = client.post("/funds/", json={
        "name": "FundA", "monthly_contribution_cents": 0, "balance_cents": 50000,
    }).json()
    fund_b = client.post("/funds/", json={
        "name": "FundB", "monthly_contribution_cents": 0, "balance_cents": 50000,
    }).json()
    li = client.post("/line-items/", json={
        "name": "Toys", "type": "fund", "fund_id": fund_a["id"],
        "amount_cents": 10000, "year": 2026, "month": 7,
    }).json()
    tx = client.post("/transactions/", json={
        "line_item_id": li["id"], "amount_cents": 20000, "date": "2026-07-15",
    }).json()

    assert client.patch(f"/line-items/{li['id']}", json={"fund_id": fund_b["id"]}).status_code == 200

    assert client.delete(f"/transactions/{tx['id']}").status_code == 200

    helpers["assert_invariant"](client)
    funds = {f["name"]: f["balance_cents"] for f in helpers["get_state"](client)["funds"]}
    assert funds["FundA"] == 50000  # original fund restored
    assert funds["FundB"] == 50000  # repoint target untouched
    assert _reversal(client, tx["id"])["to_bucket"] == f"fund:{fund_a['id']}"


def test_reporting_surfaces_agree_after_bill_and_fund_deletion(client, helpers):
    """monthly-summary, overview/monthly, and spending-breakdown must all still
    count orphaned bill + fund spends, and the breakdown labels them explicitly."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})

    bill = client.post("/line-items/", json={
        "name": "Rent", "type": "bill", "amount_cents": 200000,
        "year": 2026, "month": 7,
    }).json()
    client.post("/monthly-reserve/top-off")
    client.post("/transactions/", json={
        "line_item_id": bill["id"], "amount_cents": 50000, "date": "2026-07-15",
    })
    fund = client.post("/funds/", json={
        "name": "Vacation", "monthly_contribution_cents": 0, "balance_cents": 80000,
    }).json()
    client.post("/transactions/", json={
        "fund_id": fund["id"], "amount_cents": 20000, "date": "2026-07-16",
    })

    # Delete both buckets — the two spends become orphans.
    assert client.delete(f"/line-items/{bill['id']}").status_code == 200
    assert client.delete(f"/funds/{fund['id']}").status_code == 200
    helpers["assert_invariant"](client)

    summary = client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()
    overview = client.get("/overview/monthly", params={"months": 1}).json()["months"][-1]
    breakdown = client.get("/overview/spending-breakdown", params={"year": 2026, "month": 7}).json()

    assert summary["actual_spending_cents"] == 70000
    assert overview["spent_cents"] == 70000
    breakdown_total = sum(b["spent_cents"] for b in breakdown["bills"]) + sum(
        f["spent_cents"] for f in breakdown["funds"]
    )
    assert breakdown_total == 70000

    assert any(b["name"] == "Deleted bill" and b["spent_cents"] == 50000 for b in breakdown["bills"])
    assert any(f["name"] == "Deleted fund" and f["spent_cents"] == 20000 for f in breakdown["funds"])


def test_plan_copy_nulls_dead_fund_and_category(client, helpers):
    """Copying a plan forward must null a fund_id whose fund was deleted and a
    category_id whose category was deleted — a fund-item with a dead fund_id can
    never be spent against and would otherwise re-copy forever."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})

    cat = client.post("/line-items/categories", json={"name": "Gadgets"}).json()
    fund = client.post("/funds/", json={
        "name": "Gadgets", "monthly_contribution_cents": 0, "balance_cents": 0,
    }).json()
    client.post("/line-items/", json={
        "name": "Phone", "type": "fund", "fund_id": fund["id"],
        "category_id": cat["id"], "amount_cents": 5000, "year": 2026, "month": 7,
    })

    assert client.delete(f"/funds/{fund['id']}").status_code == 200
    assert client.delete(f"/line-items/categories/{cat['id']}").status_code == 200

    aug = client.get("/plans/2026/8").json()
    copied = [i for i in aug["line_items"] if i["name"] == "Phone"]
    assert len(copied) == 1
    assert copied[0]["fund_id"] is None
    assert copied[0]["category_id"] is None


def test_transactions_carry_source_and_status_defaults(client):
    """New transactions default source='manual', status='posted', external_id=None."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    fund = client.post("/funds/", json={
        "name": "Vacation", "monthly_contribution_cents": 0, "balance_cents": 50000,
    }).json()
    client.post("/transactions/", json={
        "fund_id": fund["id"], "amount_cents": 10000, "date": "2026-07-05",
    })

    txs = client.get("/transactions/").json()
    assert len(txs) == 1
    assert txs[0]["source"] == "manual"
    assert txs[0]["status"] == "posted"
    assert txs[0]["external_id"] is None
