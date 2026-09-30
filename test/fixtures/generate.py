#!/usr/bin/env python3
"""Generates synthetic card exports in several issuers' formats (fake data) plus fixtures.js for the browser tests.

Run: python3 test/fixtures/generate.py
"""
import csv
import io
import json
import random
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).parent
rnd = random.Random(42)

# (raw description, amex-style padded description, chase category, amex category, capital one category, low, high, per-month)
MERCHANTS = [
    ("WHOLEFDS OAK 10234", "WHOLE FOODS MARKET  OAKLAND  CA", "Groceries", "Merchandise & Supplies-Groceries", "Grocery", 40, 160, 4),
    ("TRADER JOE S #123", "TRADER JOE'S #123  OAKLAND  CA", "Groceries", "Merchandise & Supplies-Groceries", "Grocery", 25, 90, 3),
    ("SQ *BLUE BOTTLE COFFEE", "SQ *BLUE BOTTLE COFFEE  OAKLAND  CA", "Food & Drink", "Restaurant-Restaurant", "Dining", 5, 14, 8),
    ("CHIPOTLE 1234", "CHIPOTLE ONLINE  NEWPORT BEACH  CA", "Food & Drink", "Restaurant-Restaurant", "Dining", 11, 28, 3),
    ("TST* NOPALITO", "TST* NOPALITO  SAN FRANCISCO  CA", "Food & Drink", "Restaurant-Restaurant", "Dining", 40, 120, 2),
    ("AMZN Mktp US*2K4AB1CD0", "AMAZON MARKETPLACE NA PA  SEATTLE  WA", "Shopping", "Merchandise & Supplies-Internet Purchase", "Merchandise", 12, 140, 4),
    ("TARGET 00012345", "TARGET  SUNNYVALE  CA", "Shopping", "Merchandise & Supplies-General Retail", "Merchandise", 20, 110, 2),
    ("SHELL OIL 57444381201", "SHELL OIL 574443812  SAN JOSE  CA", "Gas", "Transportation-Fuel", "Gas/Automotive", 35, 70, 3),
    ("UBER *TRIP", "UBER TRIP  SAN FRANCISCO  CA", "Travel", "Transportation-Taxis & Coach", "Other Travel", 9, 45, 3),
    ("NETFLIX.COM", "NETFLIX.COM  LOS GATOS  CA", "Entertainment", "Entertainment-Other Entertainment", "Entertainment", 15.49, 15.49, 1),
    ("SPOTIFY USA", "SPOTIFY USA  NEW YORK  NY", "Entertainment", "Entertainment-Other Entertainment", "Entertainment", 11.99, 11.99, 1),
    ("PG&E WEBRECURRING", "PG&E/EZ-PAY  SAN FRANCISCO  CA", "Bills & Utilities", "Business Services-Utilities", "Utilities", 90, 180, 1),
    ("COMCAST CALIFORNIA", "COMCAST  OAKLAND  CA", "Bills & Utilities", "Communications-Cable & Internet Comm", "Phone/Cable", 79.99, 79.99, 1),
    ("CVS/PHARMACY #09876", "CVS/PHARMACY #09876  OAKLAND  CA", "Health & Wellness", "Merchandise & Supplies-Pharmacies", "Health Care", 8, 45, 1),
]

MONTHS = [(2026, 5), (2026, 6), (2026, 7), (2026, 8), (2026, 9)]


def gen_txns(seed_shift, last_day=date(2026, 9, 27)):
    r = random.Random(42 + seed_shift)
    out = []
    for y, m in MONTHS:
        for raw, amex, chase_cat, amex_cat, c1_cat, lo, hi, n in MERCHANTS:
            for _ in range(n):
                d = date(y, m, r.randint(1, 28))
                if d > last_day:
                    continue
                amt = round(r.uniform(lo, hi), 2) if lo != hi else lo
                out.append(dict(date=d, raw=raw, amex=amex, chase_cat=chase_cat, amex_cat=amex_cat, c1_cat=c1_cat, amount=amt))
    # A refund, and two identical same-day coffees (must both survive dedupe).
    out.append(dict(date=date(2026, 7, 14), raw="TARGET 00012345", amex="TARGET  SUNNYVALE  CA", chase_cat="Shopping",
                    amex_cat="Merchandise & Supplies-General Retail", c1_cat="Merchandise", amount=-42.17))
    for _ in range(2):
        out.append(dict(date=date(2026, 8, 3), raw="SQ *BLUE BOTTLE COFFEE", amex="SQ *BLUE BOTTLE COFFEE  OAKLAND  CA",
                        chase_cat="Food & Drink", amex_cat="Restaurant-Restaurant", c1_cat="Dining", amount=6.50))
    out.sort(key=lambda t: t["date"], reverse=True)
    return out


def payments(txns, desc):
    by_month = {}
    for t in txns:
        by_month.setdefault((t["date"].year, t["date"].month), 0)
        by_month[(t["date"].year, t["date"].month)] += t["amount"]
    return [dict(date=date(y, m, 25), desc=desc, amount=round(total, 2)) for (y, m), total in by_month.items()]


def write(name, header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    if header:
        w.writerow(header)
    w.writerows(rows)
    (HERE / name).write_text(buf.getvalue())
    return buf.getvalue()


fixtures = {}

# Chase: charges negative, payments positive, MM/DD/YYYY, Type column.
chase = gen_txns(0)
rows = []
for t in chase:
    rows.append([t["date"].strftime("%m/%d/%Y"), (t["date"] + timedelta(days=1)).strftime("%m/%d/%Y"), t["raw"], t["chase_cat"],
                 "Return" if t["amount"] < 0 else "Sale", f"{-t['amount']:.2f}", ""])
for p in payments(chase, "Payment Thank You-Mobile"):
    rows.append([p["date"].strftime("%m/%d/%Y"), p["date"].strftime("%m/%d/%Y"), p["desc"], "", "Payment", f"{p['amount']:.2f}", ""])
rows.sort(key=lambda r: (r[0][6:], r[0][:5]), reverse=True)
header = ["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"]
fixtures["chase"] = write("chase.csv", header, rows)
# Overlapping second export (Aug–Sep) to exercise dedupe.
fixtures["chase_overlap"] = write("chase-overlap.csv", header, [r for r in rows if r[0][6:] == "2026" and r[0][:2] in ("08", "09")])

# Amex: charges positive, padded descriptions, multi-line quoted field, "Group-Subgroup" categories.
amex = gen_txns(1)
rows = []
for t in amex:
    rows.append([t["date"].strftime("%m/%d/%Y"), t["amex"], "JANE DOE", "-41007", f"{t['amount']:.2f}",
                 "Extended details line 1\nline 2", t["amex"], "123 MAIN ST", "OAKLAND\nCA", "94612", "UNITED STATES",
                 "'320262" + str(rnd.randint(100000, 999999)) + "'", t["amex_cat"]])
for p in payments(amex, "AUTOPAY PAYMENT - THANK YOU"):
    rows.append([p["date"].strftime("%m/%d/%Y"), p["desc"], "JANE DOE", "-41007", f"{-p['amount']:.2f}", "", p["desc"], "", "", "", "", "", "Fees & Adjustments-Fees & Adjustments"])
header = ["Date", "Description", "Card Member", "Account #", "Amount", "Extended Details", "Appears On Your Statement As",
          "Address", "City/State", "Zip Code", "Country", "Reference", "Category"]
fixtures["amex"] = write("amex.csv", header, rows)

# Capital One: ISO dates, split Debit/Credit columns.
c1 = gen_txns(2)
rows = []
for t in c1:
    debit, credit = (f"{t['amount']:.2f}", "") if t["amount"] > 0 else ("", f"{-t['amount']:.2f}")
    rows.append([t["date"].isoformat(), (t["date"] + timedelta(days=1)).isoformat(), "1234", t["raw"], t["c1_cat"], debit, credit])
for p in payments(c1, "CAPITAL ONE MOBILE PYMT"):
    rows.append([p["date"].isoformat(), p["date"].isoformat(), "1234", p["desc"], "Payment/Credit", "", f"{p['amount']:.2f}"])
header = ["Transaction Date", "Posted Date", "Card No.", "Description", "Category", "Debit", "Credit"]
fixtures["capitalone"] = write("capitalone.csv", header, rows)

# Wells Fargo style: no header row, no category, charges negative.
wf = gen_txns(3)[:40]
rows = [[t["date"].strftime("%m/%d/%Y"), f"{-t['amount']:.2f}", "*", "", t["raw"]] for t in wf]
rows.append(["09/20/2026", "500.00", "*", "", "ONLINE PAYMENT THANK YOU"])
fixtures["wellsfargo"] = write("wellsfargo-noheader.csv", None, rows)

# Citi: Status column, split Debit/Credit where credits are NEGATIVE numbers, single-spaced "NAME CITY ST".
citi = gen_txns(4)
citi = citi[:45] + [t for t in citi[45:] if t["amount"] < 0]  # keep the refund
rows = []
for t in citi:
    desc = t["raw"] + (" OAKLAND CA" if "#" not in t["raw"] and "*" not in t["raw"] else " SAN FRANCISCO CA")
    debit, credit = (f"{t['amount']:.2f}", "") if t["amount"] > 0 else ("", f"{t['amount']:.2f}")
    rows.append(["Cleared", t["date"].strftime("%m/%d/%Y"), desc, debit, credit])
rows.insert(0, ["Pending", "09/28/2026", "SQ *BLUE BOTTLE COFFEE OAKLAND CA", "9.00", ""])
rows.append(["Cleared", "09/15/2026", "ONLINE PAYMENT, THANK YOU", "", "-850.00"])
rows.append(["Cleared", "09/07/2026", "Thankyou Points Redeemed TY OR123456789", "", "-25.00"])
fixtures["citi"] = write("citi.CSV", ["Status", "Date", "Description", "Debit", "Credit"], rows)

# Amex (simple 3-column export): charges positive, space-padded state, cash-back credit.
rows = [
    ["09/02/2026", "MOBILE PAYMENT - THANK YOU", "-300.00"],
    ["08/29/2026", "AMAZON MARKEPLACE NA PA", "42.10"],
    ["08/22/2026", "AplPay APPLE.COM/BILINTERNET CHARGE     CA", "2.99"],
    ["08/16/2026", "YOUR CASH REWARD/REFUND IS", "-11.50"],
    ["08/14/2026", "CRATEANDBARREL.COM  NAPERVILLE          IL", "19.99"],
    ["08/10/2026", "SP EXAMPLE-SHOP-000001  AUSTIN              TX", "27.50"],
    ["08/08/2026", "NETFLIX.COM         LOS GATOS           CA", "15.49"],
]
fixtures["amex_simple"] = write("amex-simple.csv", ["Date", "Description", "Amount"], rows)

(HERE / "fixtures.js").write_text(
    "/* Generated by generate.py - synthetic data only. */\nwindow.FIXTURES = " + json.dumps(fixtures, indent=1) + ";\n")
print("wrote", ", ".join(sorted(fixtures)))
