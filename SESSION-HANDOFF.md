# Session Handoff — 2026-05-28

> **Ephemeral.** Rewritten at the end of each session via `/log` or trigger phrase. Don't append — overwrite.

## What was done this session

### Project memory template installed
- `SESSION-HANDOFF.md`, `PROJECT-LOG.md`, `TECH-DEBT.md`, `BACKBURNER.md`, `CHANGELOG.md`, `.claude/rules/data-safety.md` added from `~/.claude-sync/templates/project-memory/`
- `CLAUDE.md`, `AGENTS.md`, `README.md`, and existing `.claude/rules/*` were left untouched (already substantial)
- `TECH-DEBT.md` seeded with known items from SCAN:AUTO block

### Spray-application sync — full design phase complete
- **Phase 0a (deere-sdk types):** Confirmed `applicationProductTotals` shape via auto-generated TS types in the unofficial deere-sdk repo. Outer `ApplicationProductTotal` = tank-mix recipe label, inner `productTotals` = constituents with `carrier: boolean` broken out.
- **Phase 0b (Harvest Profit research):** Their cost-matching is exact-string with manual user confirmation. We can do better with JD's stable productId UUIDs — auto-match across years for free.
- **Phase 0c (real-data capture):** Deployed temporary `debug-spray-shape` edge function to shared Supabase project (verify_jwt: false, ID `8c6588da-b6ed-4a91-a6f6-e77aca5fdf77`). Galen ran it via browser console. Real findings:
  - `Accept-UOM-System: ENGLISH` header makes JD return imperial natively. No conversion layer needed.
  - 2 of 3 sampled ops returned 404 on the measurement endpoint — import must handle gracefully via new `measurement_status` column.
  - Outer ApplicationProductTotal uses hex-hash productId (tank-mix recipe), inner uses UUID (catalog products). Confirmed two-layer model.
- **Codex consult complete** — 144,419 tokens via gpt-5.3-codex, 8 specific revisions, all incorporated into the spec.
- **Farm-Budget patterns audit** — transferable: explicit GRANT statements, `checkMutationResult()` frontend pattern, RLS scoped to user_id (never `using (true)`), all policies in migrations.
- **Git history check on MEASUREMENT_TYPE_MAP** — NOT abandoned. Commit `b317f12` (Jaryd Krishnan, 2026-03-27) added it deliberately. Safe scaffolding.

### Spec written
- **`docs/superpowers/specs/2026-05-28-spray-application-sync-design.md`** — comprehensive design, all decisions locked. Includes: 3 migrations (products, field_operation_products, measurement_status column), RLS + GRANT discipline, file split of `john-deere-import/` to per-action modules, new UI surfaces (`/applications`, `/products`, field-detail tab), 404 handling, Zod validation, generic errors, restricted CORS.
- Spec went through v1 → v4 with Codex consults at each pass. v3 fixed 2 internal contradictions Codex caught; v4 added the test tier matrix.

### Implementation plan written
- **`docs/superpowers/plans/2026-05-28-spray-application-sync.md`** — 45 atomic tasks across 10 phase groups (Group 0 security hardening + Groups A-I feature build). Each task has full SQL/TS code, exact commands, expected output, commit message. Self-reviewed against spec; coverage table confirms zero gaps.

### Security audit + Group 0 folded in
- Read current Watch Tower scan v6.7 (at `Public Watchtower/prompts/security-scan-prompt.md`). Compared against this project's SCAN:AUTO block (v6.4 from 2026-05-06).
- Folded 4 fixes into the plan as Group 0 (runs BEFORE Group A): `cors-open` (P1), `error-response-leakage` (P2), `route-protection-gap` (P3), `oauth-broad-scopes` (P3). All touch surfaces the spray-sync build modifies anyway.
- Explicitly NOT folded: `no-rate-limiting`, `npm-cve-residual`, other `file-over-500` files, `no-input-validation` legacy retrofit.

## Current state

- Working tree on `main` with 8 untracked items (template files + spec + temp debug function)
- All work committed locally (one commit) — NOT pushed to remote per Galen's "iterate locally" convention
- Temporary edge function `debug-spray-shape` is ACTIVE on Supabase and should be deleted after the implementation lands
- Spec is awaiting Galen's review before transitioning to `writing-plans` skill

## Open questions / decisions pending

- Galen reviews and approves the spec
- Confirm whether migrations should land on the shared Supabase project directly (no staging environment exists for this app) or stage somehow first

## Next steps (immediate)

1. Galen reads `docs/superpowers/specs/2026-05-28-spray-application-sync-design.md`
2. On approval, invoke `superpowers:writing-plans` skill to produce atomic implementation tasks
3. Execute per the phased order in spec section 11

## How to resume

Read the spec at `docs/superpowers/specs/2026-05-28-spray-application-sync-design.md` for the complete locked design. Read `PROJECT-LOG.md` 2026-05-28 entry for the decision history. Read `TECH-DEBT.md` for items addressed by this build vs. items left as-is.
