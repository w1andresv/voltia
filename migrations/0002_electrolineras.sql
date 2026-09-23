create table if not exists electrolineras (
  id text primary key,
  name text not null,
  lat double precision not null,
  lon double precision not null,
  address text,
  operator text,
  sockets jsonb not null default '[]',
  opening_hours text,
  price_per_kwh double precision,
  price_currency text not null default 'COP',
  notes text,
  photos jsonb not null default '[]',
  status text not null default 'pending',
  availability text not null default 'unknown',
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists electrolineras_status_idx on electrolineras (status);
create index if not exists electrolineras_geo_idx on electrolineras (lat, lon);
