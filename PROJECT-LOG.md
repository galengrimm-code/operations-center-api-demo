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

## 2026-05-28 — Watch Tower v6.7 security audit; folded 4 fixes into spray-sync build

**Decision:** Audited the current Watch Tower scan prompt (v6.7 in `Public Watchtower/prompts/security-scan-prompt.md`) against this project's SCAN:AUTO block (last scan v6.4, 2026-05-06). Folded 4 actionable findings into the spray-application-sync implementation plan as a new Group 0 (Security Hardening) that runs BEFORE feature work.

**Findings addressed by Group 0:**
1. `cors-open` (P1) — `_shared/cors.ts` restricted to allowlist (`operations-center-api-demo.vercel.app` + `localhost:3000`), with `Vary: Origin` for cache correctness
2. `error-response-leakage` (P2) — `_shared/generic-error.ts` added; all 4 existing functions' catch blocks retrofitted to return `{error: "request_failed", code: "<FN>_<STATUS>"}`
3. `route-protection-gap` (P3) — `middleware.ts` added using `@supabase/ssr`; `(app)/*` routes now 307 to `/login` server-side before any page HTML loads
4. `oauth-broad-scopes` (P3) — `lib/john-deere-client.ts:288` trimmed from `ag1 ag2 ag3 org1 org2 work1 work2 offline_access` to `ag1 org1 work1 offline_access`

**v6.7 additions vs v6.4 reviewed but not applicable / deferred:**
- `cors-origin-reflection` (P1 new) — avoided by allowlist approach
- `public-sensitive-endpoint` (P1 new) — Vercel-handled, no app code action
- DNS audits (DMARC/SPF/CAA) — domain config, BACKBURNER
- File-over-500 threshold changed to 1500 for JSX/TSX — relaxes existing 4 flagged JSX files; only TS files >500 still flag

**Why folded vs separate:** all 4 fixes touch surfaces this build already modifies (edge functions, shared modules, OAuth string). Doing them now means new feature code inherits the clean baseline; doing them later would require revisiting the same files twice.

**Out of scope (explicit, separate work):**
- `no-rate-limiting` (P3) — needs Upstash/Redis infrastructure decision
- `npm-cve-residual` (P4) — Next 16 major migration sprint
- Other `file-over-500` files (irrigation-analysis, progress page, reports views) — orthogonal refactors
- `no-input-validation` on legacy 4 functions — new endpoint gets Zod (plan Tasks 15, 20); legacy retrofit is follow-on

**Plan file:** `docs/superpowers/plans/2026-05-28-spray-application-sync.md` — Group 0 inserted before Group A (Tasks 0.1-0.5).

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
