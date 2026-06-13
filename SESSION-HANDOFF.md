# Session Handoff — 2026-06-13 (Terraces shipped; security cleanup done; cost-side is next)

> **Ephemeral.** Rewritten end of session.

## What was done (multi-day session: elevation → terraces → security cleanup)

### Elevation + persistence (shipped to prod earlier, `b1dc201` and prior)
Multi-pass RTK topo map, OneHertz resolution, persistence (`elevation_models`), farm filter + Precision Farms default.

### Terraces feature (shipped, `ae7ff7e`; heading/export `138e958`; codex fixes `3d571d0`)
- `operations_center.terraces` migration **applied to prod** (RLS + grants). Home Place's **35 lidar-detected lines imported** (11 crests / 24 channels) as drafts.
- `/terraces` page: Mapbox + mapbox-gl-draw — drag vertices, draw crest/channel, delete, lock-per-terrace + lock-field. Locked = read-only; drafts editable; detection only ever touches drafts. Galen verified live: "it works."
- Detection itself is an **offline prototype** in `~/Downloads/terrace-proto/` (1 m KS lidar → crest/channel centerlines → `terrace-lines.geojson`). NOT yet ported in-app (see TECH-DEBT).

### Research committed (`d364f79`, `25bce62`) + ROADMAP (`c8b7efe`)
`docs/research/`: terrace line-extraction + terrain-VR-modeling. ROADMAP.md sets the two pillars (profit-per-acre + agronomic testing engine).

### Security cleanup (`e0d6a47`, held)
- A Watchtower v7.1 scan committed `e1619d9` (OAuth state-nonce verify, CSV/XLSX formula-injection escaping, debug leak fix) AND pushed the whole branch → Vercel deployed everything held. **Verified no damage** (OAuth round-trip intact, full build+112 tests green).
- Then **deleted both unused debug edge-actions** (`debug-field-operations` + `debug-field-boundaries`) from `john-deere-import` and **deployed live** — removes leak + attack surface (codex concurred: delete > harden).
- **CLI deploy fix found:** `--use-api` (server-side bundling) via the direct binary through Bash works — sidesteps the `uv_spawn` local-bundler block. No more hand-transcribing files. (memory updated)

## Current state
- Prod: elevation + terraces + security hardening all LIVE. Terraces page works against Home Place's 35 lines.
- Git: `e0d6a47` HEAD, **1 commit held** (origin == e0d6a47's parent). Earlier commits already on origin (scan pushed them). Working tree clean after this /log commit.
- Dev server may need restart (ran build while it was up — .next gotcha).

## Open questions / pending
- **Cost-side start:** seed cost (recommended) — but verify seeding rate/variety data is imported in usable shape first.
- Any Home Place terraces built/rebuilt after 2018? (lidar vintage gap)
- Drone DSM export availability? Riser pipe diameters (Phase 4 drawdown)?
- Terraces vs Elevation tab consolidation — deferred until conservation tools land (BACKBURNER).

## Next steps (immediate)
1. **Cost side (Galen's pivot — cost BEFORE revenue):** seed cost first (verify data path → price seeding ops by variety/rate, reuse cost-calc/unit-convert). Then **other-costs bucket** (land/rent + flexible drying/hauling/insurance/equipment — a COST feature, no revenue needed) → total cost/acre per field/crop/season. Then surface cost in Reports (Application tab).
2. Revenue/profit layer DEFERRED by Galen until cost is dialed. Banked decisions: land + flexible other-costs bucket; field-level P&L first (HP parity).
3. Conservation math on locked terraces (pool storage, low spots, dirt) — when terraces thread resumes.

## How to resume
ROADMAP.md = the destination (two pillars, cost-first sequencing). Cost code: `lib/cost-calc.ts`, `lib/unit-convert.ts`, products/applications pages, `lib/applications-client.ts`. Pricing spec: `docs/superpowers/specs/2026-06-01-product-pricing-cost-layer-design.md`. Terraces live in `operations_center.terraces`; detection prototype in `~/Downloads/terrace-proto/`.
