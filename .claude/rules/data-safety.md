# Data Safety Rules (always-load)

> Always loaded by Claude Code in this project. Inviolable.

- Never run DROP, TRUNCATE, DELETE without WHERE, or UPDATE without WHERE on production data without showing me the query and waiting for "go." This Supabase project is **shared with Farm Budget / Fin Health** (ref `nuxofsjzrgdauzriraze`) — destructive SQL run against the wrong schema breaks an unrelated app.
- All Operations Center tables live in the `operations_center` schema. **Never put new tables in `public`** — that's Farm Budget's territory. All migrations must target `operations_center.<table>` explicitly.
- Never bypass Row Level Security from the client. Edge Functions use the service-role key (which bypasses RLS) for legitimate token-management reasons — that's the only sanctioned escape hatch, and it stays inside `_shared/auth.ts` and the edge functions.
- John Deere OAuth tokens (`john_deere_connections.access_token`, `refresh_token`) are sensitive: never paste their values into chat, never commit them, never echo them to logs. Refer to them by column name only.
- Customer / external organization data pulled from John Deere belongs to the customer. Don't paste full records into chat or commit them. Schema, field names, and anonymized examples are fine.
- Before `supabase db push`: confirm the linked project ref is `nuxofsjzrgdauzriraze`, not Farm Maintenance Log or another project. Pushing migrations to the wrong project is the #1 risk of a shared Supabase setup.
