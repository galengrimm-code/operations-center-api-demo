# Project Log

> Append-only log of major decisions, milestones, research findings, and data sources.
> New entries go at the TOP. Don't edit old entries — add new ones to correct/supersede them.
> Used to preserve the *why* behind decisions across many sessions over many months.
>
> **Format:** `## YYYY-MM-DD — Short title` (one ## heading per entry)
> **Rules:**
> - Never delete entries. Mark things as superseded instead: `> SUPERSEDED YYYY-MM-DD: see entry below`
> - Keep entries scoped to decisions/research/milestones — not day-to-day task progress (that goes in SESSION-HANDOFF.md)
> - Include file paths, data locations, and reasoning so future sessions can verify
> - Date format is always absolute (YYYY-MM-DD), never relative ("yesterday", "last week")

---

## 2026-05-28 — Adopted project-memory template; kicked off spray-products sync design

**Decision:** Adopt the `~/.claude-sync/templates/project-memory/` skeleton in this repo so multi-session work (starting with the spray-products sync) has a durable journal. The hub files (`CLAUDE.md`, `AGENTS.md`, `README.md`) and existing rule files in `.claude/rules/` were already substantial and stayed put — only the journal files (`SESSION-HANDOFF.md`, `PROJECT-LOG.md`, `TECH-DEBT.md`, `BACKBURNER.md`, `CHANGELOG.md`) and one new rule file (`data-safety.md`) were added.

**Why:** The next build (spray applications + product-level data tied to fields) is the first piece of work in this repo that's likely to span multiple sessions and generate decisions worth preserving (schema choices, JD API quirks, UI surface trade-offs). Without the journal, the rationale evaporates the moment the conversation ends.

**Spray-sync scope (initial framing — pending design):**
- Pull `APPLICATION` field operations from JD Ops Center (operation type already partly scaffolded in `supabase/functions/john-deere-import/index.ts:243-248` via `MEASUREMENT_TYPE_MAP`, but excluded from the `operationTypes` loop at lines 387 and 532)
- Capture the **products** applied per operation (tank mix), keyed to fields — the current `field_operations` table has no products column and isn't shaped to hold a list
- Surface products in UI tied to fields, so we can answer "what's been sprayed on field X this season" and "where did product Y get applied"
- Codex consult on the schema + sync strategy before any code lands

**Open questions deferred to brainstorm:**
- Whether JD's `fieldOperations/{id}/measurementTypes/ApplicationRateResult` actually returns the products array, or whether products live behind a separate endpoint
- Whether tillage (`TillageDepthResult`, also in the map but excluded from the loop) should be picked up in the same build
- Schema normalization: one row per (operation, product) in a new table, vs. JSONB column on `field_operations` — leaning normalized for analytics

**Files involved:**
- New: `SESSION-HANDOFF.md`, `PROJECT-LOG.md`, `TECH-DEBT.md`, `BACKBURNER.md`, `CHANGELOG.md`, `.claude/rules/data-safety.md`
- Read-only context: `supabase/functions/john-deere-import/index.ts:243-453` (operation import pipeline)
