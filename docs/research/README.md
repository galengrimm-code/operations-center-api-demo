# Research

Deep-research reports and prototype findings backing Farm Data Hub features.
Canonical research archive lives in `~/Documents/AI/Content extraction/`
(master index at `~/Documents/AI/INDEX.md`); copies here are the ones that
drive this codebase.

| Date | Document | Drives |
| --- | --- | --- |
| 2026-06-11 | [Terrace crest/channel line extraction methods](terrace-line-extraction-research-2026-06-11.md) | Phase 2 terrace detection: 1 m KS lidar substrate, geomorphons classifier, contour-directional fusion (validated by Dai et al. 2019), terraceDL fallback |
| 2026-06-11 | [Terrace detection prototype notes](terrace-detection-prototype-notes-2026-06-11.md) | Iteration history on machine-grid + ortho detection (the plateau that motivated the lidar pivot); prototype scripts in `~/Downloads/terrace-proto/` |

Key standing facts from the 2026-06-11 research:

- Kansas statewide 2018 QL2 lidar (1 m DEM, ≤10 cm vertical RMSE) is free via
  USGS S3, no auth. Home Place tile: `USGS_1M_15_x27y443_KS_Statewide_2018_A18`.
  Any field: query `tnmaccess.nationalmap.gov/api/v1/products` with a bbox.
- Iowa BMP Mapping Project proves broad-base Midwest terraces are visible in
  1 m lidar at production scale.
- 3–4 m machine-data grids are below terrace feature scale (2–5 px across a
  terrace) — fine for field topo and pool volumes, insufficient for line
  detection alone.
- Lidar is a 2018 snapshot: terraces built/rebuilt since then need drone DSM
  or machine-data evidence instead.
