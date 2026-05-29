# Changelog

> User-visible changes, one entry per release. Newest at top.
> Format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added
- **Applications** page (`/applications`) — view imported spray applications, expand to see product lines grouped by category with rate/total/area, filter by field/season/category, edit or revert individual product-line values.
- **Products** rollup page (`/products`) — quantities applied across all fields grouped by product, with editable categories.
- **Per-field applications** view (`/fields/[fieldId]/applications`).

### Changed
- _nothing yet_

### Fixed
- **Server-side auth gate no longer blocks signed-in users.** The route-protection middleware read the session from cookies while the client stored it in localStorage, so authenticated users were redirected off all protected routes back to login. The client now uses cookie-based sessions (`@supabase/ssr`).
