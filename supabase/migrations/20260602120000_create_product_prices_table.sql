-- Year-keyed input pricing. One price per product per crop-season year.
-- Cost is always derived at read time (price × converted quantity); never stored.
create table if not exists operations_center.product_prices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  org_id         text not null,
  product_id     uuid not null references operations_center.products(id) on delete cascade,
  year           integer not null,
  price_per_unit numeric not null check (price_per_unit >= 0),
  price_unit     text not null check (price_unit in ('ozm','lb','ton','floz','pt','qt','gal')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, org_id, product_id, year)
);

create index if not exists product_prices_lookup
  on operations_center.product_prices (user_id, org_id, year);

alter table operations_center.product_prices enable row level security;

create policy "own rows - select" on operations_center.product_prices
  for select using (auth.uid() = user_id);
create policy "own rows - insert" on operations_center.product_prices
  for insert with check (auth.uid() = user_id);
create policy "own rows - update" on operations_center.product_prices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows - delete" on operations_center.product_prices
  for delete using (auth.uid() = user_id);
