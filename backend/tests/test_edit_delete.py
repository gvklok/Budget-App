"""PATCH /transactions/{id}, DELETE /income/{id}, PATCH /income/{id}.

Semantics: "as if it never happened" — balances and month stats end up exactly
as if the entry had been logged the new way (or never), while the ledger keeps
the history via reversal entries. Every test asserts the invariant.
"""


def _setup(client, real_cash=500000, today="2026-07-10"):
    client.post("/dev/set-real-cash", json={"balance_cents": real_cash})
    client.post("/dev/set-simulated-date", json={"date": today})


def _bill(client, name="Groceries", amount_cents=100000, year=2026, month=7):
    r = client.post("/line-items/", json={
        "name": name, "type": "bill", "amount_cents": amount_cents, "year": year, "month": month,
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _fund(client, name, balance_cents=0, allow_negative_balance=False):
    r = client.post("/funds/", json={
        "name": name, "balance_cents": balance_cents,
        "monthly_contribution_cents": 0, "allow_negative_balance": allow_negative_balance,
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _spend(client, **body):
    body.setdefault("date", "2026-07-05")
    body.setdefault("merchant", "Store")
    r = client.post("/transactions/", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _balances(client):
    s = client.get("/state").json()
    assert s["invariant_holds"] is True, s
    return {
        "rc": s["real_cash"]["balance_cents"],
        "savings": s["savings"]["balance_cents"],
        "mr": s["monthly_reserve"]["balance_cents"],
        "funds": {f["id"]: f["balance_cents"] for f in s["funds"]},
    }


def _bill_spent(client, bill_id, year=2026, month=7):
    items = client.get("/line-items/", params={"year": year, "month": month}).json()
    return next(i for i in items if i["id"] == bill_id)["spent_cents"]


def _overview_month(client, year, month):
    months = client.get("/overview/monthly", params={"months": 3, "year": 2026, "month": 8}).json()["months"]
    return next(m for m in months if (m["year"], m["month"]) == (year, month))


def _ledger_for(client, tx_id):
    return [e for e in client.get("/ledger/").json() if e["transaction_id"] == tx_id]


# ── PATCH /transactions/{id} ────────────────────────────────────────────────

def test_edit_amount_up_and_down_on_bill(client):
    _setup(client)
    bill_id = _bill(client)
    client.post("/monthly-reserve/top-off")
    tx = _spend(client, amount_cents=3000, line_item_id=bill_id)

    r = client.patch(f"/transactions/{tx['id']}", json={"amount_cents": 5000})
    assert r.status_code == 200, r.text
    assert r.json()["amount_cents"] == 5000
    assert r.json()["line_item_name"] == "Groceries"
    b = _balances(client)
    assert b["mr"] == 100000 - 5000
    assert b["rc"] == 500000 - 5000
    assert _bill_spent(client, bill_id) == 5000
    assert _overview_month(client, 2026, 7)["bills_spent_cents"] == 5000

    r = client.patch(f"/transactions/{tx['id']}", json={"amount_cents": 1200})
    assert r.status_code == 200, r.text
    b = _balances(client)
    assert b["mr"] == 100000 - 1200
    assert b["rc"] == 500000 - 1200
    assert _bill_spent(client, bill_id) == 1200
    assert _overview_month(client, 2026, 7)["bills_spent_cents"] == 1200

    # Append-only: spend, reversal, spend, reversal, spend — all on one tx id.
    kinds = [e["kind"] for e in sorted(_ledger_for(client, tx["id"]), key=lambda e: e["id"])]
    assert kinds == ["spend", "spend_reversal", "spend", "spend_reversal", "spend"]


def test_edit_bucket_bill_to_fund_to_savings(client):
    _setup(client)
    bill_id = _bill(client)
    client.post("/monthly-reserve/top-off")
    fund_id = _fund(client, "Fun", balance_cents=20000)
    start = _balances(client)
    tx = _spend(client, amount_cents=4000, line_item_id=bill_id, merchant="Target")

    r = client.patch(f"/transactions/{tx['id']}", json={"fund_id": fund_id})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["fund_id"] == fund_id and out["line_item_id"] is None
    assert out["fund_name"] == "Fun"
    assert out["line_item_name"] is None
    assert out["destination_type"] == "external_spend"
    b = _balances(client)
    assert b["mr"] == start["mr"]
    assert b["funds"][fund_id] == 20000 - 4000
    assert b["rc"] == start["rc"] - 4000
    assert _bill_spent(client, bill_id) == 0
    m = _overview_month(client, 2026, 7)
    assert m["bills_spent_cents"] == 0 and m["funds_spent_cents"] == 4000
    breakdown = client.get("/overview/spending-breakdown", params={"year": 2026, "month": 7}).json()
    assert breakdown["bills"] == []
    assert breakdown["funds"][0]["fund_id"] == fund_id and breakdown["funds"][0]["spent_cents"] == 4000
    detail = client.get(f"/funds/{fund_id}/detail").json()
    assert detail["fund"]["balance_cents"] == 16000

    r = client.patch(f"/transactions/{tx['id']}", json={"from_savings": True})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["from_savings"] is True and out["fund_id"] is None
    assert out["destination_type"] == "external_spend"
    b = _balances(client)
    assert b["funds"][fund_id] == 20000
    assert b["savings"] == start["savings"] - 4000
    assert b["rc"] == start["rc"] - 4000
    m = _overview_month(client, 2026, 7)
    assert m["funds_spent_cents"] == 0 and m["savings_withdrawals_cents"] == 4000
    summary = client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()
    assert summary["savings_withdrawals_cents"] == 4000
    assert summary["bills_spent_cents"] == 0


def test_edit_date_across_months_moves_stats(client):
    _setup(client)
    fund_id = _fund(client, "Fun", balance_cents=20000)
    tx = _spend(client, amount_cents=2500, fund_id=fund_id, date="2026-07-20")
    assert _overview_month(client, 2026, 7)["funds_spent_cents"] == 2500

    r = client.patch(f"/transactions/{tx['id']}", json={"date": "2026-08-02"})
    assert r.status_code == 200, r.text
    assert r.json()["date"] == "2026-08-02"
    assert _overview_month(client, 2026, 7)["funds_spent_cents"] == 0
    assert _overview_month(client, 2026, 8)["funds_spent_cents"] == 2500
    july = client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()
    aug = client.get("/monthly-summary", params={"year": 2026, "month": 8}).json()
    assert july["actual_spending_cents"] == 0
    assert aug["actual_spending_cents"] == 2500
    assert client.get("/transactions/", params={"year": 2026, "month": 7}).json() == []
    assert _balances(client)["funds"][fund_id] == 17500

    # Balance series: no dip left behind in July.
    series = client.get("/overview/balance-series", params={"months": 2, "year": 2026, "month": 8}).json()["series"]
    july_points = [p for p in series["funds_total"] if p["date"].startswith("2026-07-2")]
    assert all(p["balance_cents"] == 20000 for p in july_points)


def test_merchant_only_edit_moves_no_money(client):
    _setup(client)
    fund_id = _fund(client, "Fun", balance_cents=20000)
    tx = _spend(client, amount_cents=2500, fund_id=fund_id, merchant="Old")
    before = _balances(client)
    ledger_before = client.get("/ledger/").json()

    # Re-sending the unchanged bucket/amount/date alongside counts as label-only.
    r = client.patch(f"/transactions/{tx['id']}", json={
        "merchant": "New", "fund_id": fund_id, "amount_cents": 2500, "date": "2026-07-05",
    })
    assert r.status_code == 200, r.text
    assert r.json()["merchant"] == "New"
    assert _balances(client) == before
    assert client.get("/ledger/").json() == ledger_before

    r = client.patch(f"/transactions/{tx['id']}", json={"merchant": ""})
    assert r.status_code == 200
    assert r.json()["merchant"] is None


def test_edit_tx_whose_fund_was_deleted(client):
    _setup(client)
    doomed = _fund(client, "Doomed", balance_cents=10000)
    other = _fund(client, "Other", balance_cents=10000)
    tx = _spend(client, amount_cents=3000, fund_id=doomed)
    assert client.delete(f"/funds/{doomed}").status_code == 200
    before = _balances(client)

    # No bucket given and the original is gone: must pick one, nothing moves.
    r = client.patch(f"/transactions/{tx['id']}", json={"amount_cents": 4000})
    assert r.status_code == 400
    assert _balances(client) == before

    r = client.patch(f"/transactions/{tx['id']}", json={"fund_id": other, "amount_cents": 4000})
    assert r.status_code == 200, r.text
    assert r.json()["fund_name"] == "Other"
    b = _balances(client)
    # Reversal follows the deleted fund's money to Savings; new debit hits Other.
    assert b["savings"] == before["savings"] + 3000
    assert b["funds"][other] == 10000 - 4000
    assert b["rc"] == before["rc"] + 3000 - 4000
    rev = [e for e in _ledger_for(client, tx["id"]) if e["kind"] == "spend_reversal"]
    assert rev[-1]["to_bucket"] == "savings"
    assert _overview_month(client, 2026, 7)["funds_spent_cents"] == 4000


def test_edit_insufficient_savings_rolls_back(client):
    _setup(client, real_cash=10000)
    fund_id = _fund(client, "Fun", balance_cents=5000)  # Savings now 5000
    tx = _spend(client, amount_cents=2000, fund_id=fund_id)
    before = _balances(client)
    ledger_before = client.get("/ledger/").json()

    r = client.patch(f"/transactions/{tx['id']}", json={"from_savings": True, "amount_cents": 9000})
    assert r.status_code == 400
    assert "$" in r.json()["detail"]
    assert _balances(client) == before
    assert client.get("/ledger/").json() == ledger_before
    row = next(t for t in client.get("/transactions/").json() if t["id"] == tx["id"])
    assert row["fund_id"] == fund_id and row["amount_cents"] == 2000


def test_edit_fund_respects_negative_rules(client):
    _setup(client)
    strict = _fund(client, "Strict", balance_cents=5000)
    loose = _fund(client, "Loose", balance_cents=5000, allow_negative_balance=True)
    tx = _spend(client, amount_cents=4000, fund_id=strict)

    # Reversal frees the original 4000 first, so 5000 fits exactly...
    assert client.patch(f"/transactions/{tx['id']}", json={"amount_cents": 5000}).status_code == 200
    # ...but 5001 does not.
    r = client.patch(f"/transactions/{tx['id']}", json={"amount_cents": 5001})
    assert r.status_code == 400 and "$" in r.json()["detail"]

    r = client.patch(f"/transactions/{tx['id']}", json={"fund_id": loose, "amount_cents": 9000})
    assert r.status_code == 200, r.text
    b = _balances(client)
    assert b["funds"][strict] == 5000
    assert b["funds"][loose] == -4000


def test_edit_validation(client):
    _setup(client)
    fund_id = _fund(client, "Fun", balance_cents=5000)
    tx = _spend(client, amount_cents=1000, fund_id=fund_id)
    assert client.patch("/transactions/99999", json={"amount_cents": 5}).status_code == 404
    assert client.patch(f"/transactions/{tx['id']}", json={"amount_cents": 0}).status_code == 400
    assert client.patch(f"/transactions/{tx['id']}", json={"date": "July"}).status_code == 400
    assert client.patch(f"/transactions/{tx['id']}", json={"fund_id": fund_id, "from_savings": True}).status_code == 400
    assert client.patch(f"/transactions/{tx['id']}", json={"fund_id": 99999}).status_code == 404
    # A Savings Withdrawal still needs a reason.
    r = client.patch(f"/transactions/{tx['id']}", json={"from_savings": True, "merchant": ""})
    assert r.status_code == 400
    _balances(client)


def test_edit_savings_withdrawal_keeps_transfer_out_tag(client):
    _setup(client)
    r = client.post("/transactions/", json={
        "amount_cents": 10000, "date": "2026-07-05", "merchant": "Roth IRA",
        "from_savings": True, "destination_type": "transfer_out",
    })
    tx = r.json()
    r = client.patch(f"/transactions/{tx['id']}", json={"from_savings": True, "amount_cents": 12000})
    assert r.status_code == 200, r.text
    assert r.json()["destination_type"] == "transfer_out"
    m = _overview_month(client, 2026, 7)
    assert m["transfers_out_cents"] == 12000 and m["savings_withdrawals_cents"] == 0


# ── DELETE /income/{id} ─────────────────────────────────────────────────────

def _source(client):
    r = client.post("/income-sources", json={
        "name": "RTX", "amount_cents": 200000, "frequency": "monthly", "anchor_date": "2026-07-01",
    })
    assert r.status_code == 200, r.text
    return r.json()


def _income_rows(client, **params):
    return [t for t in client.get("/transactions/", params={"include_income": True, **params}).json()
            if t["kind"] != "spend"]


def test_delete_paycheck(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    source = _source(client)
    client.post("/paycheck", json={"source_id": source["id"]})
    # Spend the paycheck down so the delete must push Savings negative.
    fund_id = _fund(client, "Fun", balance_cents=150000)
    rows = _income_rows(client)
    assert len(rows) == 1 and rows[0]["kind"] == "paycheck" and rows[0]["merchant"] == "RTX"
    entry_id = rows[0]["id"]
    assert client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()["actual_income_cents"] == 200000

    r = client.delete(f"/income/{entry_id}")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    b = _balances(client)
    assert b["savings"] == -150000
    assert b["rc"] == 0
    assert b["funds"][fund_id] == 150000
    assert client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()["actual_income_cents"] == 0
    assert _overview_month(client, 2026, 7)["income_cents"] == 0
    assert _income_rows(client) == []

    rev = next(e for e in client.get("/ledger/").json() if e["kind"] == "income_reversal")
    assert rev["reverses_entry_id"] == entry_id and rev["date"] == "2026-07-10" and rev["label"] == "RTX"

    after = client.get("/income-sources").json()[0]
    assert after == source

    r = client.delete(f"/income/{entry_id}")
    assert r.status_code == 400
    assert _balances(client) == b


def test_delete_income_wrong_kind_or_missing(client):
    _setup(client)
    fund_id = _fund(client, "Fun", balance_cents=1000)
    transfer_entry = next(e for e in client.get("/ledger/").json() if e["to_bucket"] == f"fund:{fund_id}")
    assert client.delete(f"/income/{transfer_entry['id']}").status_code == 404
    assert client.delete("/income/99999").status_code == 404
    assert client.patch("/income/99999", json={"amount_cents": 5}).status_code == 404


def test_delete_misc_income_backdated(client):
    _setup(client, real_cash=0, today="2026-08-10")
    client.post("/income/misc", json={"amount_cents": 5000, "label": "Gift", "date": "2026-07-04"})
    entry_id = _income_rows(client)[0]["id"]
    assert _overview_month(client, 2026, 7)["income_cents"] == 5000
    assert client.delete(f"/income/{entry_id}").status_code == 200
    assert _overview_month(client, 2026, 7)["income_cents"] == 0
    assert _overview_month(client, 2026, 8)["income_cents"] == 0
    assert _balances(client)["savings"] == 0


# ── PATCH /income/{id} ──────────────────────────────────────────────────────

def test_edit_income_amount_and_date_across_months(client):
    _setup(client, real_cash=0, today="2026-07-10")
    source = _source(client)
    client.post("/paycheck", json={"source_id": source["id"]})
    entry_id = _income_rows(client)[0]["id"]

    r = client.patch(f"/income/{entry_id}", json={"amount_cents": 210000})
    assert r.status_code == 200, r.text
    new_id = r.json()["entry_id"]
    assert r.json()["ok"] is True and new_id != entry_id
    assert _balances(client)["savings"] == 210000
    assert client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()["actual_income_cents"] == 210000
    rows = _income_rows(client)
    assert [(t["id"], t["kind"], t["amount_cents"], t["merchant"]) for t in rows] == [(new_id, "paycheck", 210000, "RTX")]

    r = client.patch(f"/income/{new_id}", json={"date": "2026-08-01", "label": "RTX bonus"})
    assert r.status_code == 200, r.text
    newest = r.json()["entry_id"]
    assert _overview_month(client, 2026, 7)["income_cents"] == 0
    assert _overview_month(client, 2026, 8)["income_cents"] == 210000
    assert client.get("/monthly-summary", params={"year": 2026, "month": 8}).json()["actual_income_cents"] == 210000
    rows = _income_rows(client)
    assert [(t["id"], t["date"], t["merchant"]) for t in rows] == [(newest, "2026-08-01", "RTX bonus")]
    assert _balances(client)["savings"] == 210000

    # The original can't be edited again; the pay schedule never moved.
    assert client.patch(f"/income/{entry_id}", json={"amount_cents": 5}).status_code == 400
    assert client.get("/income-sources").json()[0] == source
    assert client.patch(f"/income/{newest}", json={"amount_cents": 0}).status_code == 400


def test_edit_misc_income_keeps_kind(client):
    _setup(client, real_cash=0)
    client.post("/income/misc", json={"amount_cents": 5000, "label": "Gift"})
    entry_id = _income_rows(client)[0]["id"]
    r = client.patch(f"/income/{entry_id}", json={"label": "Birthday gift"})
    assert r.status_code == 200
    rows = _income_rows(client)
    assert len(rows) == 1 and rows[0]["kind"] == "misc_income" and rows[0]["merchant"] == "Birthday gift"
    assert _balances(client)["savings"] == 5000
