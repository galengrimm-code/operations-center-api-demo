# YieldStack Cutover Prep — Forward-Compat Migrations

> **⚠ SUPERSEDED (2026-06-16) by `v7-migration-plan.md`.** That plan replaces this one:
> instead of bridging the *old* schema with two stable-id columns, we migrate the Data Hub
> onto the full v7 schema in a new `yieldstack` schema (same project). Keep this doc only as
> the record of the bridge approach we considered and dropped.

**Status:** SUPERSEDED · **Owner:** Galen · **Created:** 2026-06-16
**Context:** Architecture decision — John Deere → **YieldStack** (multi-grower agronomic platform, own DB) → **Farm Data Hub** pulls the Precision Farms slice + overlays cost. Eventually the Data Hub *reads* agronomic data from YieldStack instead of importing it from JD itself. This doc prepares the Data Hub schema so that cutover is a **source-swap, not a data migration** — and nothing hand-entered is lost.

---

## The risk we're closing

When the cutover happens, the agronomic tables (`fields`, `field_operations`, `field_operation_products`, `products`, `john_deere_connections`) stop being written by the Data Hub and start being read from YieldStack. That data is **re-pullable from John Deere** — no loss.

But three pockets of data are **hand-entered and irreplaceable**, and they currently hang off **local-uuid FKs to tables that are about to leave**, two of them with `CASCADE DELETE`:

| Hand-entered data | Current FK | Hazard at cutover |
|---|---|---|
| `product_prices` (what you paid) | `product_id → products(id)` **CASCADE DELETE** | If `products` is moved/cleared, prices **cascade-delete** |
| `field_seasons` (planning + manual overrides) | `field_id → fields(id)` CASCADE DELETE | Breaks / cascades when `fields` moves |
| user-edits in `field_operation_products` (corrected rates, tank-mix labels) | rows live *in* a moving table | Overwritten by a fresh JD re-pull |

**Goal:** re-anchor the irreplaceable data onto the **stable John Deere IDs** (`jd_product_id`, `jd_field_id`) that *both* the Data Hub and YieldStack share — so at cutover it reattaches by itself.

---

## Moves vs. stays

| Table | Fate at cutover | Notes |
|---|---|---|
| `fields`, `field_operations`, `field_operation_products` (raw cols), `products` | **Move** → read from YieldStack via `postgres_fdw` | Re-pullable from JD; matched on `jd_*` ids |
| `john_deere_connections` | **Move** → YieldStack (multi-grower JD OAuth) | The JD pipe relocates |
| `product_prices` | **Stays** | Re-anchor on `jd_product_id` (this doc) |
| `field_seasons` | **Stays** | Re-anchor on `jd_field_id` (this doc) |
| user-edits in `field_operation_products` | **Migrate, don't re-pull** | Addressable by `jd_operation_id + line_index`; handled at cutover, not here |
| `irrigation_analysis_results` | Regenerates from YieldStack | Derived cache |

---

## Scope

**In (Phase 1, now):** add `jd_product_id` to `product_prices` and `jd_field_id` to `field_seasons`; backfill; keep them in sync via triggers; index them. Purely additive, DB-only, reversible. No app code change.

**Out (deferred to Phase 2 / cutover):** dropping the CASCADE FKs, swapping reads to the JD ids, the FDW foreign tables, migrating the JD OAuth, migrating the `field_operation_products` user-edits, anything multi-grower. None of that is needed now and none of it is safe to do before YieldStack exists.

---

## Phase 1 — the migration (additive, DB-only, non-destructive)

Single migration file targeting `operations_center.*`. The triggers derive the JD id on every write, so **no app code change is required** — the app keeps writing `product_id` / `field_id`; the trigger fills the JD id. (Invoker rights are fine: RLS scopes `products`/`fields` to the same user, so the lookup always resolves the user's own row.)

```sql
-- ============================================================
-- YieldStack forward-compat: anchor hand-entered data on stable JD ids
-- Additive only. No DROP/DELETE. Reversible (drop columns + triggers).
-- ============================================================

-- ---------- product_prices: stable JD product anchor ----------
alter table operations_center.product_prices
  add column if not exists jd_product_id text;

update operations_center.product_prices pp
set    jd_product_id = p.jd_product_id
from   operations_center.products p
where  pp.product_id = p.id
  and  pp.jd_product_id is null;

create or replace function operations_center.set_price_jd_product_id()
returns trigger language plpgsql as $$
begin
  if new.jd_product_id is null then
    select jd_product_id into new.jd_product_id
    from operations_center.products where id = new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_price_jd_product on operations_center.product_prices;
create trigger trg_price_jd_product
  before insert or update on operations_center.product_prices
  for each row execute function operations_center.set_price_jd_product_id();

create index if not exists idx_product_prices_jd_product
  on operations_center.product_prices (user_id, org_id, jd_product_id, year);

-- ---------- field_seasons: stable JD field anchor ----------
alter table operations_center.field_seasons
  add column if not exists jd_field_id text;

update operations_center.field_seasons fs
set    jd_field_id = f.jd_field_id
from   operations_center.fields f
where  fs.field_id = f.id
  and  fs.jd_field_id is null;

create or replace function operations_center.set_season_jd_field_id()
returns trigger language plpgsql as $$
begin
  if new.jd_field_id is null then
    select jd_field_id into new.jd_field_id
    from operations_center.fields where id = new.field_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_season_jd_field on operations_center.field_seasons;
create trigger trg_season_jd_field
  before insert or update on operations_center.field_seasons
  for each row execute function operations_center.set_season_jd_field_id();

create index if not exists idx_field_seasons_jd_field
  on operations_center.field_seasons (user_id, jd_field_id, season_year);
```

**Not doing yet (on purpose):** `NOT NULL` on the new columns (a future orphan could fail the constraint — enforce only after we confirm zero nulls hold over time), and the eventual `UNIQUE (user_id, org_id, jd_product_id, year)` / `(user_id, jd_field_id, season_year)` keys (those replace the current uuid-based uniques in Phase 2).

---

## Phase 2 — at cutover (documented, NOT now)

1. Point `fields`/`field_operations`/`field_operation_products`/`products` at YieldStack (FDW foreign tables or synced reads), matched on `jd_*` ids.
2. Switch `product_prices` / `field_seasons` reads + joins from the local uuid FKs to the `jd_*` ids (touch `fetchProductPrices`, `fetchProductPriceAverages`, the season-progress join).
3. **Drop the CASCADE FKs** (`product_prices.product_id → products`, `field_seasons.field_id → fields`) so dropping the moved tables can't cascade-wipe.
4. Migrate the `field_operation_products` user-edits into YieldStack, keyed on `jd_operation_id + line_index`.
5. Optionally drop the now-unused local uuid columns; swap the uniques to the JD-keyed versions.

---

## Verification (after Phase 1 runs)

```sql
-- backfill completeness — expect 0 (any rows = orphaned price/season, investigate)
select count(*) from operations_center.product_prices where jd_product_id is null;
select count(*) from operations_center.field_seasons  where jd_field_id  is null;

-- trigger works — insert a price, confirm jd_product_id auto-populates
```

Plus: `npm run prebuild` (lint + typecheck + 88 vitest) stays green — Phase 1 touches no TS, so this should be unaffected; run it to confirm nothing regressed.

---

## Safety (data-safety.md compliance)

- Shared Supabase project `nuxofsjzrgdauzriraze` — confirm the linked project ref **before** `supabase db push` (the #1 shared-DB risk).
- All statements target `operations_center.*` explicitly. **No `DROP`, `DELETE`, `TRUNCATE`, or `UPDATE` without `WHERE` in Phase 1.** The two `UPDATE`s are backfills scoped by a join + `is null` guard.
- Per data-safety rules: the exact SQL above is shown for review; **nothing runs until Galen says go.**

---

## Documentation tasks (the "documented properly" checklist)

- [ ] This doc — the plan (done).
- [ ] On `go`: create `supabase/migrations/<NNNN>_ys_forward_compat_stable_ids.sql` with a header comment pointing back here.
- [ ] After it lands: update `.claude/rules/database.md` — add `jd_product_id` to `product_prices` and `jd_field_id` to `field_seasons`, each noted as "stable-id anchor for the YieldStack cutover; local FK dropped in Phase 2."
- [ ] Add a `TECH-DEBT.md` entry for the deferred Phase 2 (FK drops, read swaps, user-edit migration) so it isn't forgotten.

---

## Rollback

Phase 1 is additive, so rollback is clean and loses no data (the original uuid FKs are untouched):

```sql
drop trigger if exists trg_price_jd_product on operations_center.product_prices;
drop function if exists operations_center.set_price_jd_product_id();
drop index  if exists operations_center.idx_product_prices_jd_product;
alter table operations_center.product_prices drop column if exists jd_product_id;
-- (mirror for field_seasons)
```

---

## Open decisions for Galen

1. **Trigger vs. app dual-write** for keeping the JD ids in sync. Recommendation: **trigger** (DB-only, can't miss a write path, no TS change). App dual-write is the alternative if you'd rather not add triggers.
2. **One migration file or two** (`product_prices` + `field_seasons`). Recommendation: **one** — they're the same change for the same reason.
3. **Enforce `NOT NULL`** now or after a soak period. Recommendation: **after** — confirm zero nulls first so a future orphan can't fail an insert.
