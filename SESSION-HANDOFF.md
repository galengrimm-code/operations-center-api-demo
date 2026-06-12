# Session Handoff — 2026-06-11 (Elevation+persistence SHIPPED; terraces detected via lidar; VR research done)

> **Ephemeral.** Rewritten end of session.

## What was done this session (long session)

### Shipped to production (pushed through `b1dc201`)
- Elevation feature (multi-pass topo), OneHertz resolution (edge fn v13), parallel pulls + auth refresh, global farm filter + Precision Farms default, persistence (`elevation_models` migration APPLIED). All codex-gated, Galen-verified live.

### Terrace detection — SOLVED via lidar (prototype offline, NOT yet in app)
- Machine-grid + ortho fusion plateaued (~85%, fragmented). Root cause via deep-research: **3-4m machine grid is below terrace feature scale.**
- **Pivot to free USGS 1m KS QL2 lidar** (tile `KS_1m_x27y443.tif` downloaded to `~/Downloads/terrace-proto/lidar/`). Detection on lidar = clean continuous crest+channel lines.
- Pipeline (all in `~/Downloads/terrace-proto/`): `prep_lidar.py` → `detect_lidar.py` → `prune_lines.py` (graph spur-prune + dominant-path + crest-channel pairing + waterway/loop rejection). Output: **`terrace-lines.geojson`** — 11 crests / 24 channels, terrace_id-grouped, world coords. Galen validated visually against ortho (`crop-*.png`): lines sit on real banding.
- Caveat: lidar is **2018 snapshot** — terraces built/rebuilt since won't appear (Galen to confirm; drone DSM or driven tracks fill gaps).

### UNCOMMITTED app changes (in working tree, need commit + codex)
- `lib/elevation-merge.ts`: heading capture in extractElevationPoints
- `lib/elevation-store.ts` + `components/elevation/elevation-view.tsx`: grid Export button + per-pass points (with headings) in export
- `lib/terrace-detect.ts` + tests + `components/elevation/*`: in-app DEM terrace detect + "Detect terraces"/"Export grid" buttons + magenta map layer (commit `203db8e` partial — verify what's staged vs not)
- **2 codex reviews OWED** (quota was exhausted ~12:36, now reset): the terrace-detect commit `203db8e` and the heading/export changes.

### Research committed to repo (`d364f79`, `25bce62`)
- `docs/research/`: terrace line-extraction methods + **terrain/slope VR modeling** (Advanced Agrilytics/SWAT MAPS landscape, terrain-yield science, VR economics). Canonical copies in `~/Documents/AI/Content extraction/topics/Agronomy/`.

### ROADMAP.md created (`c8b7efe`)
- Project north star set: **agronomic engine, two pillars** — (1) profit per acre (sub-acre by zone = differentiator over Harvest Profit), (2) agronomic testing/fine-tuning engine (treatment-vs-response trials that GENERATE the calibration no vendor coefficient provides). Terrain work reframed as the spatial substrate both run on. Phased sequence in ROADMAP.md; framing decision logged in PROJECT-LOG.md.

### Decisions made this session
- **Terraces UI plan** (mockup: `~/Downloads/terraces-ui-mockup.html`): new Terraces page, `terraces` table (RLS), import GeoJSON as drafts, edit/lock screen (mapbox-gl-draw), detection only ever touches drafts not locked lines.
- **Gator-with-RTK** will drive crest/channel lines → `driven` source (highest trust), folds into + calibrates lidar.
- **Long-term thesis validated by research**: terrain layers (slope/TPI/TWI/flow) → yield-by-terrain overlay → VR seed/fertility zones → profit-per-acre. Build the map+zones; calibration (terrain→N rate) needs Galen's own strip trials.

## Current state
- `main` ahead of origin by the uncommitted work + `203db8e` + research commits. Dev server on localhost:3000.
- Terrace detection proven; not yet productized.

## Open questions
- Any Home Place terraces built/rebuilt after 2018? (lidar gap)
- Drone platform DSM export? (asked repeatedly, still unanswered)
- Riser pipe diameters (Phase 4 drawdown).

## Immediate next steps
1. **Close out**: commit uncommitted app changes, run the 2 owed codex reviews (quota back), push.
2. **Terraces feature build** (next session, planned + mocked): `terraces` table migration → import `terrace-lines.geojson` → Terraces page with edit/lock UI (`driven` source supported day one). Port lidar pipeline in-app or run per-field offline + import.
3. Then payoff math: crest profiles + low spots, pool stage-storage, dirt volumes.
4. Then terrain-derivative layers (slope/TPI/TWI/flow) → yield-by-terrain → VR zones → profit layer.
5. Watchtower leftovers: P2 debug-field-operations leakage, P3 silent catches in settings.

## How to resume
Prototype + all scripts: `~/Downloads/terrace-proto/` (lidar pipeline, NOTES.md). Terraces lines ready: `terrace-lines.geojson`. UI mockup: `~/Downloads/terraces-ui-mockup.html`. Research: `docs/research/`. Roadmap above.
