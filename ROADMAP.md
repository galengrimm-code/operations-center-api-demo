# Roadmap — Farm Data Hub

> Where this project is going and why. Long-horizon direction, not a task list
> (tasks live in SESSION-HANDOFF.md, ideas in BACKBURNER.md, decisions in
> PROJECT-LOG.md). Revisit when a pillar advances or the destination shifts.
>
> **Last set:** 2026-06-11

---

## The vision: an agronomic engine for the farm

Farm Data Hub is becoming **the place where every acre's data comes together and
answers two questions**:

1. **What did this acre make me?** — By-the-acre cost and profit. As-applied
   inputs + yield + grain price → exact margin per acre, per field, per zone.
   Know which ground pays and which ground bleeds.
2. **What should I do differently here?** — An agronomic fine-tuning engine.
   Treat the farm as a testing platform: vary inputs (N rate, variety, seeding
   rate) across known conditions (soil type, landscape position), measure the
   response, and learn each acre's real optimum.

Everything else — John Deere sync, the elevation/terrain work, terraces, the
cost layer — is foundation or feeder for those two pillars.

The pillars feed each other: **Pillar 1 tells you what happened financially;
Pillar 2 tells you why and how to change it.** And critically — Pillar 2 is how
we *generate* the agronomic calibration that turns terrain and soil data into
real input decisions. (Outside research, 2026-06-11: the terrain-yield map is
replicable, but turning "wet footslope" into a fertilizer rate needs on-farm
strip trials — nobody's coefficient transfers between fields. The testing engine
IS that calibration generator. See `docs/research/terrain-vr-modeling-research-2026-06-11.md`.)

---

## Pillar 1 — Profit per acre

**Goal:** open a field, see margin by acre and by zone, every year.

| Layer | Status |
| --- | --- |
| JD field/operation/boundary sync | ✅ shipped |
| Application data + product-level detail | ✅ shipped |
| Input pricing + per-acre **cost** (NH3 %, unit conversion, density) | ✅ shipped 2026-06 |
| Yield data (harvest ops imported) | ✅ in DB |
| **Profit layer** — yields × grain price − input costs = margin/field/acre | ⏳ **next major build** (retires the $1,600/yr Harvest Profit subscription) |
| Grain pricing input (+ optional land cost / overhead) | ⏳ with profit layer |
| **Sub-acre profit** — margin mapped by terrain/yield zone, not just field average | ◻️ after terrain layers exist |
| Forward-year budgeting (pre-season) | ◻️ backburner |

**The leap that makes this special:** field-average profit is table stakes
(Harvest Profit does it). **Profit *by zone* — overlaying margin on terrain and
yield-stability zones — is the differentiator.** That's where you see the
terrace channel that drowns three years in four and costs you money, or the
knob that never pays for its fertilizer.

---

## Pillar 2 — Agronomic testing & fine-tuning engine

**Goal:** "We put 180 lb N here and 100 lb right beside it; here's the response
in each soil type / landscape position. So next year, here's the rate."

Treat the farm as a permanent replicated trial. The data to do this is already
flowing in (as-applied rates are spatial, yield is spatial); the engine is the
analysis layer that connects treatment → condition → response.

| Capability | Status / notes |
| --- | --- |
| As-applied rate data (spatial, per-product) | ✅ flowing from JD |
| Spatial yield response | ✅ in DB |
| **Zone substrate** — soil type, landscape position, wetness to slice response by | ◻️ needs terrain layers (below) + soil data import |
| **Treatment-vs-response analysis** — same field, different rates, compare yield by condition | ◻️ the core build |
| **Strip-trial design helper** — lay out check strips, track them, read them | ◻️ later |
| **Recommendation output** — per-zone rate suggestions from accumulated trials | ◻️ the payoff; needs years of data |

**Honest scope (from research):** good yield prediction ≠ reliable rate
prescription, and rates don't transfer between fields. So Pillar 2 isn't "the
app tells you the rate" on day one — it's "the app accumulates *your* trial
results until *your* fields tell you the rate." The value compounds with
seasons. We build the engine; the farm fills it with truth.

---

## The terrain foundation (feeds both pillars)

Both pillars need to slice the farm into meaningful sub-acre zones. That's what
the elevation/terrain work is for — it's not a side quest, it's the spatial
substrate.

| Layer | Status |
| --- | --- |
| Multi-pass RTK elevation model + topo map | ✅ shipped 2026-06-11 |
| Persisted per-field elevation grid | ✅ shipped 2026-06-11 |
| 1 m USGS lidar substrate (whole farm, free) | ✅ proven; in-app port pending |
| Terrace crest/channel lines (detect → edit → lock) | ⏳ next feature build |
| **Terrain derivatives** — slope, TPI, TWI, flow accumulation | ◻️ the layers that drive zones |
| Driven RTK Gator tracks (`driven` source — truth geometry + calibrates lidar) | ◻️ data-collection path |
| Drone DSM ingest (when export confirmed) | ◻️ optional upgrade |
| Conservation math — pool storage, low spots, dirt volumes, watershed rating | ⏳ rides on locked terrace lines |

Research backing: terrain + hydrology explains ~73% of within-field yield
variance, and the wet/dry flip (low ground wins dry years, drowns wet years) is
settled science — exactly the signal Pillar 1 maps to dollars and Pillar 2 tunes
inputs against. See `docs/research/`.

---

## Sequence (current best plan)

1. **Terraces feature** — `terraces` table, import detected lines, edit/lock UI.
   *(In progress; lines for Home Place already detected.)*
2. **Conservation math** on locked terraces — pool storage, low spots, dirt
   volumes. (First payoff of the terrain foundation; answers the 10-inch-rain
   questions.)
3. **Profit layer (Pillar 1 core)** — grain price + P&L math; retire Harvest
   Profit. Field-average first.
4. **Terrain derivative layers** — slope/TPI/TWI/flow from lidar; the zone
   substrate.
5. **Sub-acre profit** — Pillar 1 mapped onto zones. The differentiator.
6. **Agronomic testing engine (Pillar 2 core)** — treatment-vs-response by zone.
7. **Recommendation + strip-trial tooling** — the compounding payoff.

Steps 3 and 4 are independent and can interleave. Everything from 5 on is the
"agronomic engine" proper — the reason the foundation exists.

---

## What we build vs. what we don't

- **We own:** the data integration, the maps, the zones, the profit math, the
  trial-tracking engine, the per-farm learning loop.
- **We don't fabricate:** transferable agronomic coefficients (someone else's
  "wet ground = −20 lb N"). Those come from *our* strip trials, accumulated over
  seasons — which is precisely what Pillar 2 is built to capture. The moat the
  paid agronomy services hold is years of calibration data; ours grows every
  harvest the engine runs.

---

## Out of scope (for now)

- Multi-tenant / selling this to other farms (it's an internal engine first;
  revisit only if the two pillars prove out and someone asks).
- Real-time / in-season prescriptions pushed back to equipment (read-and-learn
  before write-and-prescribe).
- Replacing the agronomist's judgment — this informs decisions, it doesn't make
  them.
