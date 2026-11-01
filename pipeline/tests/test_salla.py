import datetime as dt, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import salla  # noqa: E402


class DailyTests(unittest.TestCase):
    def test_counting_rules_match_the_old_dashboard(self):
        am = {"total": 0, "disc": 10.0, "ship": 20.0, "cod": 5.0, "tax": 13.0}
        cache = {
            "1": dict(day="2026-10-01", status="completed", total=100.0, draft=False, pp=False, am=am),
            "2": dict(day="2026-10-01", status="under_review", total=50.0, draft=False, pp=False),
            "3": dict(day="2026-10-01", status="canceled", total=70.0, draft=False, pp=False),
            "4": dict(day="2026-10-01", status="refunded", total=30.0, draft=False, pp=False),
            "5": dict(day="2026-10-01", status="completed", total=999.0, draft=True, pp=False),
            "6": dict(day="2026-10-02", status="delivered", total=40.0, draft=False, pp=False),
        }
        r = salla.daily(cache, dt.date(2026, 10, 1), dt.date(2026, 10, 3))
        self.assertEqual([x["day"] for x in r], ["2026-10-01", "2026-10-02", "2026-10-03"])
        d1 = r[0]
        self.assertEqual((d1["orders"], d1["net_sales_sar"], d1["gross_sales_sar"]), (1, 100.0, 110.0))
        self.assertEqual((d1["shipping_sar"], d1["vat_sar"], d1["refunds_sar"]), (25.0, 13.0, 30.0))
        self.assertEqual((d1["canceled_orders"], d1["pending_review_orders"]), (1, 1))
        self.assertEqual((r[1]["orders"], r[2]["orders"]), (1, 0))


if __name__ == "__main__":
    unittest.main()
