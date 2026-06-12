---
target: "Terrain/slope modeling for variable-rate fertilizer and seeding"
slug: terrain-vr-modeling
canonical_entity_id: terrain-vr-modeling
topic_area: Agronomy
type: research
skill_version: "3.4.0"
mode: landscape
window: null
next_questions:
  - "What on-farm N-rate strip trial design would let Galen build his own terrain-to-EONR coefficients?"
  - "Which open-source TWI/flow-accumulation algorithm best matches terrace-channel ponding (WhiteboxTools D-inf vs SAGA vs GRASS r.watershed)?"
  - "How to normalize 10 years of JD yield maps to field-relative and classify stability zones in the Farm Data Hub pipeline?"
run_date: 2026-06-11
status: complete
apis_used: [serpapi, serper, exa, openalex]
sources_count: 26
gaps:
  - "Advanced Agrilytics pricing is quote-only; no independent grower reviews online (AgTalk threads are employee-dominated)"
  - "Kravchenko 2008 (WI x precip) paywalled — recovered from snippets"
  - "de Lara 2023 EONR study is wheat/barley Argentina — method strong, rate transfer weak"
supersedes: null
tags:
  domain: agronomy
  artifact_type: topic-synthesis
---

# Research: Terrain/Slope Modeling for Variable-Rate Fertilizer & Seeding

Date: 2026-06-11 · Mode: Landscape · For: Farm Data Hub terrain roadmap (NE KS dryland corn/soy, terraces, 1m lidar + RTK machine elevation + 10yr yield maps)

## TL;DR

The terrain math behind Advanced Agrilytics, SWAT MAPS, and the rest is **textbook and replicable** — flow accumulation, topographic position (TPI), and topographic wetness index (TWI) off a clean DEM, intersected with multi-year yield, are exactly the layers the science says matter, and you already have better elevation data than most. The science is settled that **topography drives within-field yield through water movement**, with a real **wet-year/dry-year flip** (low/wet ground wins dry years, drowns wet years) — terrain + hydrology hits r²≈0.73 for yield. The genuine moat the paid players hold is **not software — it's the calibration layer**: years of soil sensing and replicated strip trials that turn "this is a wet footslope" into "apply N lbs less here." Build the maps yourself; respect that turning zones into *defensible N rates* needs your own on-farm strips, not someone's transferable coefficient.

## The space

Everyone is selling a version of the same insight: whole-field uniform management wastes money because water (and the nutrients it carries) moves across the field by terrain, creating sub-acre "environments" with different yield ceilings and different optimal inputs. They split into two philosophies:

- **Terrain-first** (SWAT MAPS, Advanced Agrilytics, CropQuest, the drainage tools): elevation/water-movement is the foundation layer; zones are built from where water goes.
- **Yield-history-first** (Premier Crop): zones from multi-year yield + economics; terrain enters only as a soil-survey attribute.

The science (below) favors **fusing both** — and says terrain-derived wetness specifically out-returns soil-survey-map zones.

## Players

| Player | Approach | Terrain role | Model | Pricing |
|---|---|---|---|---|
| **Advanced Agrilytics** | "Sub-acre causal agronomy" — hex grid <3.3 ac, water movement as master variable; Terraframing fuses yield+elevation+OM+CEC into "environments" | Foundational (flow/slope-position/wetness → denitrification, drought, diffusion) | Agronomist service + TerraSIGNAL software (Essential/Advanced/Elite); 1M+ ac, 8 states | Quote-only; claims up to 4.7x ROI, +20 bu/ac/10yr, 15% less N/bu |
| **SWAT MAPS** (Croptimistic) | Soil+Water+Topography → fixed 10 zones, ground-truthed | Foundational; elevation drives water model | Service via dealer network + proprietary SWAT BOX EC/soil sensor | Quote-only; 98% retention |
| **Premier Crop** | Yield history + soil survey + grid sampling + **cost data** → A/B/C economic zones | Minor (slope/drainage as soil attributes) | Agronomist advisory + software | Quote-only |
| **GeoPard** | Automated multi-layer zones: satellite + yield + DEM relief | One selectable layer (slope/aspect/flow) | **Self-serve SaaS** | Subscription |
| **Geo-Surface / Drain-IQ** | Auto-fetch public lidar → flow/ponding/wetness + tile design | The whole product (drainage only, no Rx) | Self-serve software | **Drain-IQ ~C$999/yr** — clearest price in market |
| **CropQuest** (KS) | Elevation + soils + yield in consulting zones | Significant (hilltops/water holes/slopes) | Regional consulting | Quote-only |

**Closest to "build it yourself":** GeoPard fuses DEM relief + yield into zones without an agronomist; Geo-Surface/Drain-IQ prove the self-serve lidar→wetness workflow but stop at drainage. None of them have your combination of inputs (RTK machine elevation + 1m lidar + 10yr JD yield + drone).

## The science — what's settled

Across 5 peer-reviewed sources (Maestrini & Basso 2018 *Sci Reports*, 338 Midwest fields; Chang 2025 USDA/*Remote Sensing*; Eyre 2020 Guelph MSc on lidar; de Lara 2023 *Precision Ag*; Kravchenko 2008 *Agron J*):

1. **Topography is a real, repeatable yield driver, working through water.** Slope, relative topographic position, and wetness/flow indices recur as the workhorses. Bare topography explains r²≈0.38 of yield; **add flow/wetness and it jumps to r²≈0.73** (Chang). Terrain alone gave GWR yield R² of **0.71–0.80** in a variable field (Eyre). **Flow accumulation alone buys r²≈0.62** — the single cheapest high-value layer.
2. **The wet/dry flip is genuine and unanimous.** High-wetness/depressional/flow-convergent positions yield *above* field average in **dry** years (stored water) and *below* it in **wet** years (waterlogging at emergence). Stated three independent ways across the sources. This is the core mechanism for your terrace channels.
3. **Year-to-year variance usually exceeds spatial within-field variance** — climate is the bigger lever, which is *why* static soil-map zones underperform and why "stability zone" framing (consistently-high / consistently-low / unstable) beats single-year maps.

## The science — what's contested

**Translating zones into optimal N rates is NOT settled.** de Lara 2023 is the cold shower: terrain predicts *yield* well, but the sign and magnitude of its effect on **economic optimal N rate flips between fields**, cross-field model transfer is unreliable, and two good ML models disagreed on EONR by ~2×. So "wet acre always wants less N" is not established. **Good yield prediction ≠ reliable rate prescription.** Also unsettled: best single wetness algorithm (TWI vs flow accumulation vs Downslope Index), and how much tillage/management damps the terrain signal.

## VR economics — does it pay (corn/soy)?

- **Modest and variability-dependent.** ~$2.84/ac (Illinois) to $12.53/ac (Ohio); pays when field variability exceeds ~10%; needs 15–20% rate difference between zones to bother separating.
- **The money is profit-shaping, not seed savings** — ISU is explicit: high zones get *more* seed, so the seed bill doesn't drop. One honest skeptic quit after 10 years of RTK trials: "no ROI" once equipment was counted.
- **Counterintuitive:** it's the **low-yielding zones that make VR work** — good ground is forgiving across a wide population band; poor/drought-prone ground is where wrong population costs you. Dryland floors ~28–30k, caps ~36–40k.
- **ISU trial: topographic wetness index had the greatest return-to-seed** — beating yield-history and soil-suitability methods. For terraced ground (a topography story by definition), this is the strongest single finding in the whole survey.

## Settled / Contested / Unknown

- **Settled:** Terrain drives yield via water; wet/dry flip is real; flow accumulation + TWI + TPI carry the defensible signal; temporal > spatial variance; TWI-based zones out-return soil-survey zones for seeding.
- **Contested:** Whether terrain → N *rate* generalizes (it doesn't transfer across fields); best wetness algorithm; VR seeding ROI net of equipment.
- **Unknown:** Galen's own field-specific terrain→rate coefficients — only on-farm strip trials answer this; nobody's published number substitutes.

## The replicable recipe (what Farm Data Hub should build)

1. **Condition the lidar DEM** — hydrologically correct (breach/fill depressions, WhiteboxTools/SAGA/GRASS), flagging true closed depressions separately as waterlogging-risk acres.
2. **Compute a compact terrain stack** (all free): **slope, TPI (relative topographic position), TWI, raw flow accumulation, profile/plan curvature.** Four-to-five layers carry essentially all defensible signal; more adds collinearity.
3. **Normalize each year's yield map** to % of field mean (strips the year effect), then **classify acres by stability** across the 10+ years (consistently-high / consistently-low / unstable). Unstable ≈ high-TWI weather-swing acres ≈ terrace channels.
4. **Regress normalized yield on the terrain stack** (Random Forest + SHAP to see drivers, or interpretable GWR); validate with **spatial** cross-validation, not random k-fold.
5. **Translate to management, not borrowed rates:** fixed prescriptions on consistently-high/low acres; **tactical** (weather-conditional, side-dress) on unstable/wet acres; tile/alternate-use on chronic bottom-10% depressions. Build terrace-channel-aware seeding (lower dryland pops in drought-prone channels). For real N *rates*, run your own N-rate strips — don't hard-code someone else's curve.

## What this means for the build (self-applied)

This research validates the elevation/terrain side of Farm Data Hub as a genuinely valuable product direction, not a vanity feature — it's the same foundation the $1M-ARR-class players sell, and Galen's input data (RTK machine + 1m lidar + drone + decade of JD yield) is at or above their elevation quality. The honest scope line: **the platform can own the map and the zones; it cannot fabricate the agronomic calibration** that turns a wet footslope into a fertilizer rate — that's strip trials and soil sampling, Galen's to generate over seasons. Sequencing: terrain-derivative layers (slope/TPI/TWI/flow) are the next foundation after the elevation model + terraces; yield-by-terrain overlay is the first analytical payoff; VR prescriptions and profit-zone mapping ride on top once a few years of normalized yield are stacked. Pairs directly with the [terrace line extraction research](terrace-line-extraction-2026-06-11/REPORT.md) (same lidar substrate) and the standing profit-per-acre layer goal.

## Key claims & evidence chains

| Claim | Independent lines | Traces to | Confidence |
|---|---|---|---|
| Terrain+hydrology explains majority of yield variance (r²≈0.73) | 2 (Chang RF; Eyre GWR 0.71-0.80) | distinct datasets/methods | firm |
| Wet/dry flip (low ground wins dry, drowns wet) | 3 (Maestrini precip sign-flip; Chang drought-only; Kravchenko WI×precip spline) | independent | firm |
| TWI zones out-return soil-survey zones for seeding | 1 | ISU extension trial | attributed |
| Terrain→EONR does NOT transfer across fields | 1 | de Lara 2023 (wheat/barley) | attributed, method-strong |
| VR seeding ROI modest ($3-13/ac), variability-dependent | 3 (farmdoc, OSU, MDPI) | independent | firm |

## Next-pass questions

- `/research on-farm nitrogen rate strip-trial design for building field-specific terrain-to-EONR response curves`
- `/research WhiteboxTools vs SAGA vs GRASS for topographic wetness index and flow accumulation on agricultural lidar DEMs`
- `/research methods to normalize multi-year yield monitor maps to field-relative and classify yield stability zones`

## Sources

Advanced Agrilytics: [science](https://advancedagrilytics.com/science/), [Agrilytics IQ](https://advancedagrilytics.com/technology/agrilytics-iq/), [Terraframing](https://advancedagrilytics.com/smarter-soil-sampling-terraframing-brings-sub-acre-precision-to-fertility-decisions/), [TerraSIGNAL PR](https://www.biospace.com/press-releases/advanced-agrilytics-introduces-terrasignal-an-ai-native-agronomic-platform-built-on-proven-sub-acre-science), [agwired ROI](https://agwired.com/2025/04/30/new-data-from-advanced-agrilytics-shows-higher-productivity/), [EQIP/conservation](https://advancedagrilytics.com/making-conservation-pay-how-advanced-agrilytics-can-help-you-get-rewarded-for-your-conservation-practices/) · Science: [Maestrini & Basso 2018](https://www.nature.com/articles/s41598-018-32779-3), [Chang 2025 USDA](https://www.nass.usda.gov/Research_and_Science/Cropland/docs/2025_Hydro-TopographicContrib.pdf), [Eyre 2020 Guelph](https://atrium.lib.uoguelph.ca/bitstream/10214/21242/1/Eyre_Riley_202009_MSc.pdf), [de Lara 2023](https://link.springer.com/article/10.1007/s11119-023-10018-8), [Kravchenko 2008](https://acsess.onlinelibrary.wiley.com/doi/abs/10.2134/agronj2007.0325) · Competitors: [SWAT MAPS](https://swatmaps.com/how-it-works/), [DeTurk Ag](https://www.deturkag.com/swat-maps), [Premier Crop](https://www.premiercrop.com/tag/yield-efficiency/), [GeoPard zones](https://geopard.tech/management-zones-vra-maps/), [Geo-Surface](https://www.geo-surface.com/geo-surface-viewer/), [Drain-IQ](https://www.gis4ag.com/drain-iq/), [CropQuest](https://www.cropquest.com/precision-ag-services/management-zones/), [McArthur/AgWeb](https://www.agweb.com/news/business/technology/tech-farm-mcarthur-ag-ventures-flips-script-traditional-vra) · VR economics: [ISU extension](https://crops.extension.iastate.edu/post/variable-rate-seeding-it-right-you), [farmdoc](https://origin.farmdocdaily.illinois.edu/2019/05/variable-vs-uniform-seeding-rates-for-corn.html), [OSU AGF-520](https://ohioline.osu.edu/factsheet/agf-520), [MDPI VR review](https://www.mdpi.com/2077-0472/12/2/305), [AgTalk thread](https://talk.newagtalk.com/forums/thread-view.asp?tid=655987)
