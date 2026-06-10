# Changelog

> User-visible changes, one entry per release. Newest at top.
> Format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added

- **Input pricing & per-acre cost.** Set product prices per year on the **Products** page; cost flows to `$/ac • $/unit` on every application line, an application total, and a per-field input-cost summary with an **Actual / Spread** toggle (per-applied-acre vs spread over the whole field).
- **Unit conversion built in** — price in tons/gallons even when applied in pounds/fluid-ounces; the cost and Total Applied convert automatically. Cross-family (priced $/ton, applied in gallons) uses a per-product **density**.
- **NH3 / nutrient products** — a per-product **Content %** handles inputs recorded by nutrient (lb of N) but bought by product (ton of NH3 at 82% N), so the cost reflects what you actually purchased.
- **Bulk tools** (behind a toggle) — copy a year's prices forward, or set one unit across a whole category (e.g. all fertilizer → ton).
- **Excel + PDF export** of the Products rollup, with rows color-coded by category (fertilizer / chemical / seed / adjuvant).
- **Applications** page (`/applications`) — view imported spray applications, expand to see product lines grouped by category with rate/total/area, filter by field/season/category, edit or revert individual product-line values. Now with a per-field **Import Applications** trigger + progress bar.
- **Products** rollup page (`/products`) — quantities applied across all fields grouped by product, with editable categories, sortable columns, a category filter, and one **Season** selector (a year, or All Seasons average).
- **Per-field applications** view (`/fields/[fieldId]/applications`) with the input-cost summary.

### Changed

- **New "Farm Data Hub" app icon** across favicon, tab, app, and PWA/home-screen.
- **Total Applied** on Products now reads in your **purchase unit** (e.g. tons, gallons) once a price unit is set, instead of the raw applied unit.

### Fixed

- **Spray applications now import.** The import was returning nothing because the John Deere connection lacked the `ag2`/`ag3` scopes that application/chemical data needs (reconnect required after the fix). Large imports also now run per-field with a progress bar instead of timing out.
- **Dropdown menus are readable** — native select options were faint gray on the dark theme.
- **Server-side auth gate no longer blocks signed-in users.** The route-protection middleware read the session from cookies while the client stored it in localStorage, so authenticated users were redirected off all protected routes back to login. The client now uses cookie-based sessions (`@supabase/ssr`).
