# Terrace detection prototype — state at 2026-06-11

## Goal

Auto-extract Home Place terrace centerlines. Two signal sources:

1. **Machine-data DEM** (4 m grid in `operations_center.elevation_models`) — ridges stand only ~0.1–0.3 ft above trend after gridding/smoothing → DEM-only detection is draft-quality (committed as `lib/terrace-detect.ts` + preview button, repo commit 203db8e).
2. **Post-rain ortho** (`Downloads\ortho-2025\`, 3 cm, flown ~06-07 after the 10" rain) — terrace channels visible as dark, texture-dead, curvilinear bands.

## Iterations on the ortho (detect_scars.py)

1. bright+ungreen threshold → wrong polarity (caught dry crusts only)
2. dark+ungreen global threshold → too conservative (bands are only LOCALLY dark)
3. difference-of-Gaussians bandpass (σ 6/50 px @ ~0.6 m/px) → ~50% recall, sprayer-track false positives
4. + texture-energy fusion → no better, patchy
5. **sato vesselness on inverted bandpass (sigmas 4-11) → best so far (~60% recall, fragments, still catches sprayer tracks)** ← current script state

## The plan that should finish it (next session)

- **Orientation prior from the DEM:** terraces follow elevation contours; sprayer tracks/field edges don't. Gate the vesselness response on alignment between the band direction (Hessian eigenvector from sato) and the local DEM contour direction (perpendicular to gradient). Kills false positives.
- **Gap-join along contour direction**, not straight-line: walk the contour field between fragment endpoints.
- **Snap final centerlines to DEM channel** (negative residual) for the analysis-grade line.
- Port winner to TS or keep as a server-side step; wire into the Detect terraces button (replace DEM-only call).
- DEM grid for fusion: pull full-res from `elevation_models` (jsonb) — in-app it's already client-side; offline use the strided SQL (see chat 2026-06-11) or add a dev export.
- **If Galen's drone platform can export a DSM** from the same flight, use it instead of everything above — cm-grade elevation makes detection trivial. (Asked 3×, unanswered.)

## Files

- `detect_scars.py` — current vesselness pipeline. Usage: `python detect_scars.py [pct] [min_obj_px] [close_r]`, writes `overlay.png`.
- `boundary.json` — Home Place boundary ring (lon/lat).
- World file constants for the ortho are hardcoded in the script (EPSG:3857, 0.0373 m/px).
