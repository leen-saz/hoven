"""One-off: copy the old Hoven dashboard's Salla daily history (supabase/seed/salla_orders_daily.csv, 2023-08-29 on)
into salla_orders_daily. Existing days are kept (ignore-duplicates), so the live pipeline always wins.
Run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python supabase/seed_salla_history.py"""
import csv, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
from modules.core.supa import Supa  # noqa: E402

NUM = {"orders", "orders_with_detail", "canceled_orders", "pending_review_orders"}


def rows(path):
    for r in csv.DictReader(open(path, encoding="utf-8")):
        out = {"day": r.pop("date")}
        for k, v in r.items():
            if k in ("source", "fetched_at"):
                out[k] = v
            elif v != "":
                out[k] = int(float(v)) if k in NUM else float(v)
        yield out


def main():
    db = Supa.from_env()
    if not db:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing")
    data = list(rows(os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed", "salla_orders_daily.csv")))
    for i in range(0, len(data), 500):
        db.req("/rest/v1/salla_orders_daily?on_conflict=day", "POST", data[i:i + 500], "resolution=ignore-duplicates,return=minimal")
    print(f"seed: {len(data)} days {data[0]['day']}..{data[-1]['day']}, {sum(r['orders'] for r in data)} orders")


if __name__ == "__main__":
    main()
