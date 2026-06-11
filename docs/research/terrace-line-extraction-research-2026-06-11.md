---
target: "Automatic extraction of agricultural terrace crest/channel centerlines"
slug: terrace-line-extraction
canonical_entity_id: terrace-line-extraction
topic_area: Agronomy
type: deep-research
skill_version: "3.4.0"
run_date: 2026-06-11
status: complete
apis_used: [serpapi, serper, exa]
sources_count: 24
cves: []
exposure: none
gaps:
  - "Dai et al. 2019 exact accuracy metrics (IEEE 418-blocked; method reconstructed from open metadata + EGU companion abstract)"
  - "terraceDL figshare blocks programmatic fetch (browser download works)"
  - "Mapping Conservation Practices via Centerline Dice Loss (T&F 2024) paywalled"
supersedes: null
tags:
  domain: agronomy-engineering
  artifact_type: topic-synthesis
---

# Deep Research: Extracting Terrace Crest/Channel Centerlines (Farm Data Hub Phase 2)

Generated: 2026-06-11 · Context: Home Place (~97 ac, Brown Co. KS), broad-base terraces 0.5–1.5 ft proud, 30–60 ft wide. Data in hand: 3 m bean-pass RTK grid, 3 cm post-rain ortho.

## TL;DR

Free **2018 Kansas statewide QL2 lidar (1 m DEM, ≤10 cm vertical RMSE) covers the field — one unauthenticated HTTPS GET** — and the Iowa BMP project proves at production scale that Midwest broad-base terraces are plainly visible in exactly this data class. No off-the-shelf tool outputs crest/channel **centerlines** (every published DL model outputs area masks; fluvial-terrace tools don't transfer), but our contour-directional fusion is independently validated as the right architecture (Dai et al. 2019 published the same idea for Chinese agricultural terraces). The winning recipe: swap the 3–4 m machine grid for the 1 m lidar as the structural substrate, keep the ortho + headings as evidence/validation, and extract lines with terrace-tuned classical geomorphometry.

## The direct answers

### Is our 3–4 m machine grid fundamentally below feature scale?

**Yes, marginally but decisively.** A 30–60 ft terrace is 9–18 pixels wide at 1 m and only 2–5 pixels at 3–4 m. With IDW bridging 40–60 ft pass gaps, the interpolation acts as a low-pass filter at exactly the terrace wavelength. RTK precision was never the problem; sampling geometry is. This is why five tuning rounds plateaued at ~85%/fragmentary.

### Does 1 m lidar resolve broad-base terraces?

**Yes — proven, not theoretical.** The Iowa BMP Mapping Project (ISU GIS Facility) hand-digitized terraces, WASCOBs, and grassed waterways for the entire state of Iowa from 1 m lidar DEM/hillshade/slope. NRCS itself uses lidar DEMs for terrace/contour design (USGS FS 2016-3088). Geometry: 15–45 cm of relief vs ≤10 cm vertical RMSE at QL2.

### Is the tile available for Home Place?

**Yes — verified live via TNM Access API.** Project `KS_Statewide_2018_A18` (flown 2018, QL2, DEM published 2023). The field's tile:

```
https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/KS_Statewide_2018_A18/TIFF/USGS_1M_15_x27y443_KS_Statewide_2018_A18.tif
```

10×10 km GeoTIFF, ~297 MB, NAVD88, UTM 15N, no auth. Any field's tile findable via `https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Digital Elevation Model (DEM) 1 meter&bbox=...`. **Caveat: 2018 snapshot** — any terrace rebuilt/maintained since then reflects pre-work geometry; machine data and drone remain the current-condition truth.

### Is there an off-the-shelf model or tool?

**No tool outputs crest/channel centerlines.** Survey of what exists:

| Approach | Output | Code/weights | Transfers to broad-base? |
|---|---|---|---|
| Loess Plateau UNet++ (Sci Data 2023) | area raster | training scripts only, no weights | No — bench terraces, 30 m DEM |
| NLDF-Net (MDPI RS 2024) | area masks | nothing released | No |
| Negev U-Net+OBIA (2023) | masks incl. walls (IoU ~30) | nothing released | Recipe yes, model no |
| SVM Roya Valley (Land 2025) | platform polygons | ArcGIS clicks | No |
| LSDTopoTools terrace/channel | rasters | Docker, runs | **No — fluvial only** (needs a river datum; 5 m min height default) |
| TerEx, GRASS r.terrace.geom | polygons/rasters | yes | Fluvial/landform framing; pattern only |
| **Dai et al. 2019 (IEEE Access)** | **ridge centerlines** | **method only, no code** | **Yes — agricultural, contour-directional** |
| **terraceDL (Maxwell, WVU 2023)** | DL dataset: **Iowa ag terraces**, lidar derivatives + labels + PyTorch notebooks | **yes (figshare)** | **Yes — same landform vocabulary** |

**Dai et al. 2019** = OBIA candidates + Canny edges on imagery + DEM contour-direction gating → ridge lines. Independently the architecture we converged on this afternoon; treat as validation, not a shortcut (no code, Loess Plateau tuning, exact metrics unretrievable — IEEE blocked).

**terraceDL** is the sleeper: lidar DTM chips + terrain derivatives with labels from the Iowa BMP digitization, split by HUC8, with segmentation notebooks (companion: Farhadpour & Maxwell, PLOS One 2025). If classical methods fall short, fine-tuning on terraceDL and predicting on our 1 m tile is the credible DL path — Iowa broad-base terraces are the same animal as Kansas ones.

### The classical pipeline that practitioners' literature supports

1. **FeaturePreservingSmoothing** (WhiteboxTools) on the 1 m DEM — denoise without rounding the riser breaks.
2. **Geomorphons** (WhiteboxTools/GRASS `r.geomorphon -m`) with terrace-tuned parameters: search ≈ 30–50 m, skip ≈ 3–5 m, and **flatness threshold dropped to ~0.3–0.5°** (the 1° default erases sub-degree features — the single most important knob; a 0.5 ft rise over 40 ft is ~0.2°). Ridge/spur classes → crest; valley/hollow → channel.
3. Cross-check with **MaxElevationDeviation / MultiscaleTopographicPosition** tuned to 10–20 m scales (multiscale local z-score lights up berms and channels).
4. Vectorize class rasters → centerlines (skeletonize, as Glaubius did for terrace risers via profile curvature on 1 m DEMs), prune by minimum length.
5. Our existing additions stay: ortho scar evidence + bean-pass heading prior for gap-joining and the 2018-vs-today disagreement check.

All free (WhiteboxTools has a Python wheel that runs on Windows; no Docker needed), and steps 1–3 are also straightforward to replicate in our existing numpy pipeline.

## Recommended recipe for Farm Data Hub

1. **Download the 1 m tile** (one GET), crop to field, reproject UTM→our local frame.
2. **Re-run the fusion with lidar as the DEM layer**: contour directions, terrace-scale residual, and slope from lidar (10× crisper); ortho vesselness + bean headings unchanged. Expect the recall problem to mostly evaporate — the lidar sees every terrace at full amplitude regardless of how faintly it ponded.
3. **Add geomorphons/DEVmax** as the crest/channel classifier on lidar (replaces our hand-rolled residual-sign split with the literature-standard method).
4. **Vector cleanup → editable draft lines → Galen locks.** (Unchanged plan; detection quality should now justify it.)
5. **Datum/condition check**: difference lidar (2018) against the machine-data surface (current) — disagreement bands flag terraces reworked since 2018; bonus product: that difference map is itself a record of dirt work.
6. **Fallback if needed**: terraceDL fine-tune (PyTorch, labels in hand) — only if 1–3 underdeliver.
7. **Bonus**: the same lidar tile covers the whole farm — every other field's terrace detection comes free, machine passes or not.

## What would flip this verdict

If the 2018 lidar predates major terrace construction on target fields (lines built 2019+ won't exist in it), the drone DSM (still unconfirmed from Galen's platform) or a new mapping flight becomes the substrate instead. Nothing else found would change the recommendation.

## Source assessment (key sources)

| # | Source | Type | Credibility | Contribution |
|---|---|---|---|---|
| 1 | TNM Access API live query | primary data | authoritative | Tile ID + URL for Home Place |
| 2 | Iowa BMP Mapping Project (ISU) | production dataset | high | Proof 1 m lidar shows broad-base terraces |
| 3 | terraceDL (figshare 22320373) + Farhadpour & Maxwell PLOS One 2025 | dataset + paper | high | Ready labeled Iowa terrace DL dataset |
| 4 | Dai et al. 2019, IEEE Access 7:129215 (DOI 10.1109/ACCESS.2019.2940437) | peer-reviewed | high (metrics unverified) | Validates contour-directional architecture |
| 5 | r.geomorphon manual + MDPI RS 17:1040 | tool doc + paper | high | Parameterization for subtle linear features |
| 6 | Glaubius terrace extraction (1 m DEM, curvature→centerlines) | academic project | medium | Riser→centerline workflow precedent |
| 7 | USGS FS 2016-3088 | gov fact sheet | high | NRCS lidar-for-terrace-design practice |
| 8 | LSDTopoTools docs/repos | tool docs | high | Ruled out (fluvial-only) |
| 9 | Loess Plateau / NLDF-Net / Negev / Roya papers | peer-reviewed | medium-high | Ruled out for centerlines; recipe support |

## All sources

1. https://tnmaccess.nationalmap.gov/api/v1/products (live query)
2. https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/KS_Statewide_2018_A18/TIFF/USGS_1M_15_x27y443_KS_Statewide_2018_A18.tif
3. https://data.kansasgis.org/kslidar/Reports/2018_Reports/Report_Block12.pdf
4. https://www.gis.iastate.edu/BMPs
5. https://figshare.com/articles/dataset/terraceDL_A_geomorpholgy_deep_learning_dataset_of_agricultural_terraces_in_Iowa_USA/22320373
6. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0325904
7. https://ieeexplore.ieee.org/document/8832143/ (Dai et al. 2019; + EGU companion https://ui.adsabs.harvard.edu/abs/2019EGUGA..21.6265D/abstract)
8. https://grass.osgeo.org/grass-stable/manuals/r.geomorphon.html
9. https://www.mdpi.com/2072-4292/17/6/1040
10. https://glaubius.github.io/projects/TerraceExtraction.html
11. https://onlinelibrary.wiley.com/doi/10.1002/esp.3464 (TerEx)
12. https://ojs3.mtak.hu/index.php/hungeobull/article/view/20897
13. https://lsdtopotools.github.io/LSDTT_documentation/LSDTT_floodplains_terraces.html
14. https://github.com/LSDtopotools/LSDTopoTools_FloodplainTerraceExtraction
15. https://lsdtopotools.github.io/LSDTT_documentation/LSDTT_channel_extraction.html
16. https://github.com/edinaj0zs4/terrace_extraction_grassgis
17. https://www.nature.com/articles/s41597-023-02005-5
18. https://www.mdpi.com/2072-4292/16/9/1649
19. https://www.sciencedirect.com/science/article/pii/S1569843223000924 (via Europe PMC PMC10165466)
20. https://www.mdpi.com/2073-445X/14/5/962
21. https://pubs.usgs.gov/fs/2016/3088/fs20163088.pdf
22. https://www.tandfonline.com/doi/full/10.1080/29979676.2024.2401756 (paywalled; title/abstract only)
23. https://data.usgs.gov/datacatalog/data/USGS:6703f8c0d34eabaa4a39b91b (ruled out — no terrace class)
24. https://www.whiteboxgeo.com/manual/wbt_book/ (via jblindsay mirror)
