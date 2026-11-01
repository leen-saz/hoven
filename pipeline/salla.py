"""Salla orders -> Supabase (salla_orders cache + salla_orders_daily). Read-only on the store.

Ported from leen-saz/hoven-dashboard salla_api.py with the same counting rules (reconciled against
Salla's monthly summary). Differences: tokens come from the Connectors page (Supabase Vault, V_SALLA_*)
instead of Vercel Blob, and the per-order cache lives in Supabase instead of a local JSON file.

Salla refresh tokens are single-use: the new pair is written back to the Vault (connector_put) before
any API call, so a crash later in the run never loses the token. Never prints token material.
Exit 0 with a message when Salla is not connected yet.
"""
import datetime as dt
import json, os, sys, time, urllib.parse, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from modules.core.supa import Supa  # noqa: E402

API = "https://api.salla.dev/admin/v2"
TOKEN_URL = "https://accounts.salla.sa/oauth2/token"
DAYS = int(os.environ.get("SALLA_DAYS", "35"))
FULL_FROM = os.environ.get("SALLA_FROM", "2023-01-01")
DETAIL_MAX = int(os.environ.get("SALLA_DETAIL_MAX", "400"))
RIYADH = dt.timezone(dt.timedelta(hours=3))
EXCLUDED = {"canceled", "cancelled", "deleted", "restoring", "restored", "refunded", "under_review",
            "payment_pending", "pending_payment", "draft"}
REFUND = {"restoring", "restored", "refunded"}
CANCEL = {"canceled", "cancelled", "deleted"}


def skip(msg):
    print("salla:", msg)
    sys.exit(0)


def val(name):
    return (os.environ.get("V_" + name) or os.environ.get(name) or "").strip()


def amt(x):
    if isinstance(x, dict):
        x = x.get("amount")
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def http(url, data=None, headers=None):
    for i in range(7):
        req = urllib.request.Request(url, data=data, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as ex:
            if ex.code == 429:
                time.sleep(min(2 ** i + 1, 40))
                continue
            if ex.code == 401:
                skip("Salla API 401: اربط سلة من جديد من صفحة الربط")
            raise RuntimeError(f"HTTP {ex.code}") from None
    raise RuntimeError("HTTP 429 (rate limit)")


def access_token(db):
    cid, cs, ref = val("SALLA_CLIENT_ID"), val("SALLA_CLIENT_SECRET"), val("SALLA_REFRESH_TOKEN")
    if not (cid and cs and ref):
        skip("سلة مو مربوطة بعد (صفحة الربط ← سلة)")
    j = http(TOKEN_URL, urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": ref,
                                                "client_id": cid, "client_secret": cs}).encode())
    tok, new_ref = j["access_token"], j.get("refresh_token")
    print(f"::add-mask::{tok}")
    if new_ref:
        print(f"::add-mask::{new_ref}")
        if new_ref != ref:   # single-use: store the new one first
            db.req("/rest/v1/rpc/connector_put", "POST", {"p_name": "SALLA_REFRESH_TOKEN", "p_value": new_ref})
    return tok


def order_day(o):
    d = o.get("date")
    return (d.get("date", "") if isinstance(d, dict) else str(d or ""))[:10]


def list_range(get, a, b, cache):
    """Orders dated [a, b], month by month (the list endpoint caps at 500 pages x 30)."""
    n, m = 0, a
    while m <= b:
        e = min((m.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1), b)
        page = 1
        while True:
            j = get("/orders", from_date=m.isoformat(), to_date=e.isoformat(), page=page, per_page=30)
            for o in j.get("data", []):
                c = cache.setdefault(str(o["id"]), {})
                slug = str((o.get("status") or {}).get("slug", "")).lower()
                if c.get("status") != slug or abs((c.get("total") or 0) - amt(o.get("total"))) > 0.005:
                    c.pop("am", None)   # changed -> fetch the detail again
                c.update(day=order_day(o), status=slug, total=amt(o.get("total")),
                         draft=bool(o.get("draft")), pp=bool(o.get("is_pending_payment")), dirty=True)
                n += 1
            pg = j.get("pagination") or {}
            if page >= int(pg.get("totalPages") or pg.get("total_pages") or 1):
                break
            page += 1
        m = e + dt.timedelta(days=1)
    return n


def daily(cache, start_day, today):
    """Same rules as the old dashboard: counted = status not excluded; net = amounts.total; gross = net + discounts."""
    z = lambda: dict(orders=0, net=0.0, disc=0.0, ship=0.0, refunds=0.0, tax=0.0, det=0, canc=0, canc_sar=0.0, rev=0, rev_sar=0.0)
    agg = {}
    for c in cache.values():
        if not c.get("day") or c.get("draft") or c.get("pp"):
            continue
        a = agg.setdefault(c["day"], z())
        s, am = c["status"], c.get("am")
        if s in REFUND:
            a["refunds"] += c["total"]
        elif s in CANCEL:
            a["canc"] += 1; a["canc_sar"] += c["total"]
        elif s in EXCLUDED:
            a["rev"] += 1; a["rev_sar"] += c["total"]
        else:
            a["orders"] += 1; a["net"] += c["total"]
            if am:
                a["det"] += 1; a["disc"] += am["disc"]; a["ship"] += am["ship"] + am["cod"]; a["tax"] += am["tax"]
    now = dt.datetime.now(RIYADH).isoformat(timespec="minutes")
    rows, d = [], start_day
    while d <= today:
        a = agg.get(d.isoformat(), z())
        rows.append(dict(day=d.isoformat(), orders=a["orders"], net_sales_sar=round(a["net"], 2),
                         gross_sales_sar=round(a["net"] + a["disc"], 2), discounts_sar=round(a["disc"], 2),
                         shipping_sar=round(a["ship"], 2), refunds_sar=round(a["refunds"], 2), vat_sar=round(a["tax"], 2),
                         orders_with_detail=a["det"], canceled_orders=a["canc"], canceled_sar=round(a["canc_sar"], 2),
                         pending_review_orders=a["rev"], pending_review_sar=round(a["rev_sar"], 2),
                         source="salla_api_orders_v2", fetched_at=now))
        d += dt.timedelta(days=1)
    return rows


def load_cache(db):
    cache, off = {}, 0
    while True:
        part = db.req(f"/rest/v1/salla_orders?select=id,day,status,total,draft,pending_payment,amounts&order=id&limit=1000&offset={off}") or []
        for r in part:
            cache[r["id"]] = dict(day=r["day"], status=r["status"], total=float(r["total"]), draft=r["draft"],
                                  pp=r["pending_payment"], **({"am": r["amounts"]} if r.get("amounts") else {}))
        if len(part) < 1000:
            return cache
        off += 1000


def upsert(db, table, rows, conflict):
    for i in range(0, len(rows), 500):
        db.req(f"/rest/v1/{table}?on_conflict={conflict}", "POST", rows[i:i + 500], "resolution=merge-duplicates,return=minimal")


def main():
    db = Supa.from_env()
    if not db:
        skip("بدون Supabase")
    tok = access_token(db)
    h = {"Authorization": "Bearer " + tok, "Accept": "application/json"}
    get = lambda path, **q: http(API + path + ("?" + urllib.parse.urlencode(q) if q else ""), headers=h)
    today = dt.datetime.now(RIYADH).date()
    start = today - dt.timedelta(days=DAYS - 1)
    cache = load_cache(db)
    full = os.environ.get("SALLA_FULL") == "1" or not cache
    n = list_range(get, dt.date.fromisoformat(FULL_FROM) if full else start, today, cache)
    need = sorted((k for k, c in cache.items() if c["status"] not in EXCLUDED or c["status"] in REFUND),
                  key=lambda k: cache[k]["day"], reverse=True)
    win = [k for k in need if cache[k]["day"] >= start.isoformat()]
    old = [k for k in need if cache[k]["day"] < start.isoformat() and "am" not in cache[k]][:DETAIL_MAX]
    for k in win + old:
        am = (get(f"/orders/{k}").get("data") or {}).get("amounts") or {}
        cache[k]["am"] = {"total": amt(am.get("total")),
                          "disc": round(sum(float(x.get("discount") or 0) for x in am.get("discounts") or []), 2),
                          "ship": amt(am.get("shipping_cost")), "cod": amt(am.get("cash_on_delivery")),
                          "tax": amt((am.get("tax") or {}).get("amount"))}
        cache[k]["dirty"] = True
    upsert(db, "salla_orders", [dict(id=k, day=c["day"], status=c["status"], total=c["total"], draft=c["draft"],
                                     pending_payment=c["pp"], amounts=c.get("am"))
                                for k, c in cache.items() if c.get("dirty") and c.get("day")], "id")
    first = min((c["day"] for c in cache.values() if c.get("day")), default=start.isoformat())
    rows = daily(cache, dt.date.fromisoformat(first) if full else start, today)
    upsert(db, "salla_orders_daily", rows, "day")
    print(f"salla: {n} طلب ({'كامل' if full else f'آخر {DAYS} يوم'})، {len(rows)} يوم، "
          f"{sum(r['orders'] for r in rows)} طلب محسوب")


if __name__ == "__main__":
    main()
