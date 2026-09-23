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

insert into electrolineras (
  id, name, lat, lon, address, operator, sockets, opening_hours,
  price_per_kwh, price_currency, notes, photos, status, availability
) values (
  'el_seed_uis',
  'UIS Bucaramanga · Carga pública',
  7.1406,
  -73.1212,
  'Cra. 27 con cl. 9, Bucaramanga',
  'UIS / Celsia',
  '[{"connector":"type2","powerKw":22,"count":4},{"connector":"ccs2","powerKw":50,"count":1}]'::jsonb,
  'Mo-Su 06:00-22:00',
  650,
  'COP',
  'Acceso en campus. Preferible horario diurno.',
  '[]'::jsonb,
  'approved',
  'available'
) on conflict (id) do nothing;

insert into electrolineras (
  id, name, lat, lon, address, operator, sockets, opening_hours,
  price_per_kwh, price_currency, notes, photos, status, availability
) values (
  'el_seed_aratoca',
  'Terpel Aratoca (aporte)',
  6.696,
  -73.158,
  'Vía nacional, Aratoca, Santander',
  'Terpel Voltex',
  '[{"connector":"ccs2","powerKw":60,"count":2},{"connector":"type2","powerKw":22,"count":1}]'::jsonb,
  '24/7',
  890,
  'COP',
  'Reportada por un conductor. Falta confirmar potencia real del CCS.',
  '[]'::jsonb,
  'pending',
  'unknown'
) on conflict (id) do nothing;
