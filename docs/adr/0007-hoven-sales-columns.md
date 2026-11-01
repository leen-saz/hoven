# ADR-0007: Sales in Well's result columns

Status: accepted (2026-11-01)

## Context
Well's pipeline, Supabase tables, template and decision modules all count one "result" per ad and day
(`leads`) plus `conversations`. Hoven is a store: the result is a purchase and its value.

## Decision
Keep Well's row shape `[key, day, spend, impr, clicks, leads, conv]` and its tables, and give the columns Hoven meanings:
- `leads` = purchases (Meta `omni_purchase`/`purchase`, Google conversions in category PURCHASE only, Snap `conversion_purchases`).
- `conv` / `ad_metrics.conversations` = purchase value in SAR, rounded (Meta `action_values`, Google `conversions_value`, Snap `conversion_purchases_value`).
- USD accounts are converted at 3.75 (as the old Hoven dashboard did).
- UI text: ليدز → طلبات, محادثات → الإيراد (ر.س), CPL → CPA.
- Salla store sales live in their own tables (`salla_orders`, `salla_orders_daily`, migration 012).

## Consequences
Every Well module (suggestions, critic, learning) works unchanged on purchases. A later migration can rename
the columns once the dashboards are split into Astro pages.
