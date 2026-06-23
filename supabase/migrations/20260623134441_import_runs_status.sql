-- Durable import-run status so long imports survive the ~150s edge gateway timeout.
--
-- The john-deere-import function can run >150s on a full re-import (hundreds of
-- John Deere API calls). The Supabase gateway 504s the browser at ~150s while the
-- function keeps running to completion server-side. Instead of holding the
-- connection open (and showing the user a scary 504 on an import that actually
-- succeeds), the function now records each run here and the client polls this row
-- for the outcome. See supabase/functions/john-deere-import/import-run.ts +
-- lib/john-deere-client.ts (mirrors the existing pollForShapefileUrl pattern).
create table if not exists operations_center.import_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  org_id      text not null,
  action      text not null,
  status      text not null default 'running'
                check (status in ('running', 'done', 'error')),
  result      jsonb,
  error_code  text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists import_runs_user_action_started_idx
  on operations_center.import_runs (user_id, action, started_at desc);

alter table operations_center.import_runs enable row level security;

-- Users read only their own runs; only the service role (edge function) writes.
drop policy if exists "own import runs" on operations_center.import_runs;
create policy "own import runs"
  on operations_center.import_runs
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on operations_center.import_runs to authenticated;
