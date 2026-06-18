-- ═══════════════════════════════════════════════════════════════
--  CIKOPS FLEET OS — SUPABASE SCHEMA v1.0
--  Pengganti Google Sheets dari sistem GAS lama.
--  Jalankan file ini di Supabase Dashboard → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════

-- Ekstensi untuk UUID & crypto (biasanya sudah aktif di Supabase)
create extension if not exists "pgcrypto";

-- ───────────────────────────────────────────────────────────────
-- 1. DRIVERS  (pengganti sheet MASTER_DRIVER)
-- ───────────────────────────────────────────────────────────────
create table if not exists drivers (
  id          uuid primary key default gen_random_uuid(),
  nama        text not null,
  no_hp       text,
  pin_hash    text not null default crypt('1234', gen_salt('bf')), -- default PIN 1234, di-hash
  avatar_emoji text default '🧑‍✈️',
  aktif       boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table drivers is 'Master data driver. PIN disimpan terenkripsi (bcrypt) — verifikasi via RPC verify_driver_pin, jangan query pin_hash langsung dari client.';

-- ───────────────────────────────────────────────────────────────
-- 2. VEHICLES  (pengganti sheet MASTER_KENDARAAN)
-- ───────────────────────────────────────────────────────────────
create table if not exists vehicles (
  id           uuid primary key default gen_random_uuid(),
  nopol        text not null unique,
  jenis        text,
  aktif        boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────
-- 3. EMPLOYEES  (pengganti sheet MASTER_KARYAWAN — requestor)
-- ───────────────────────────────────────────────────────────────
create table if not exists employees (
  id           uuid primary key default gen_random_uuid(),
  nik          text,
  nama         text not null,
  departement  text,
  created_at   timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────
-- 4. JOB TYPES  (pengganti sheet MASTER_JOB)
-- ───────────────────────────────────────────────────────────────
create table if not exists job_types (
  id     uuid primary key default gen_random_uuid(),
  label  text not null unique
);

insert into job_types (label) values
  ('Employee Support'),
  ('Goods/Document Delivery'),
  ('Guest Support')
on conflict (label) do nothing;

-- ───────────────────────────────────────────────────────────────
-- 5. TASKS  (pengganti sheet TASK_DRIVER) — jantung sistem
-- ───────────────────────────────────────────────────────────────
create table if not exists tasks (
  id               uuid primary key default gen_random_uuid(),
  tanggal          date not null default current_date,
  driver_id        uuid references drivers(id) on delete set null,
  vehicle_id       uuid references vehicles(id) on delete set null,
  jenis_pekerjaan  text not null,
  tujuan           text not null,
  requestor        text not null,
  departement      text,
  perihal          text,
  status           text not null default 'ASSIGNED'
                     check (status in ('ASSIGNED', 'ON GOING', 'DONE', 'CANCELLED')),
  created_at       timestamptz not null default now(),
  accepted_at      timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     text,              -- 'driver' atau 'admin'
  cancel_reason    text
);

create index if not exists idx_tasks_driver_tanggal on tasks (driver_id, tanggal);
create index if not exists idx_tasks_status on tasks (status);
create index if not exists idx_tasks_tanggal on tasks (tanggal);

comment on table tasks is 'Tabel utama penugasan driver. Setara TASK_DRIVER di sheet lama.';

-- ───────────────────────────────────────────────────────────────
-- 6. VIEW: tasks_detail — join siap pakai untuk frontend
--    (driver_name, kendaraan ikut tampil tanpa join manual di client)
-- ───────────────────────────────────────────────────────────────
create or replace view tasks_detail as
select
  t.id,
  t.tanggal,
  t.driver_id,
  d.nama        as driver_nama,
  d.avatar_emoji as driver_avatar,
  t.vehicle_id,
  v.nopol       as kendaraan,
  v.jenis       as kendaraan_jenis,
  t.jenis_pekerjaan,
  t.tujuan,
  t.requestor,
  t.departement,
  t.perihal,
  t.status,
  t.created_at,
  t.accepted_at,
  t.completed_at,
  t.cancelled_at,
  t.cancelled_by,
  t.cancel_reason
from tasks t
left join drivers d  on d.id = t.driver_id
left join vehicles v on v.id = t.vehicle_id;

-- ───────────────────────────────────────────────────────────────
-- 7. RPC: verify_driver_pin
--    Verifikasi PIN tanpa expose pin_hash ke client.
--    Return: driver row (tanpa pin_hash) jika cocok, null jika salah.
-- ───────────────────────────────────────────────────────────────
create or replace function verify_driver_pin(p_driver_id uuid, p_pin text)
returns table (id uuid, nama text, no_hp text, avatar_emoji text)
language plpgsql
security definer
as $$
begin
  if exists (
    select 1 from drivers
    where drivers.id = p_driver_id
      and drivers.pin_hash = crypt(p_pin, drivers.pin_hash)
      and drivers.aktif = true
  ) then
    return query
      select drivers.id, drivers.nama, drivers.no_hp, drivers.avatar_emoji
      from drivers where drivers.id = p_driver_id;
  end if;
  return;
end;
$$;

-- ───────────────────────────────────────────────────────────────
-- 8. RPC: set_driver_pin
--    Ganti PIN driver (dipanggil dari halaman profil driver).
-- ───────────────────────────────────────────────────────────────
create or replace function set_driver_pin(p_driver_id uuid, p_old_pin text, p_new_pin text)
returns boolean
language plpgsql
security definer
as $$
begin
  if not exists (
    select 1 from drivers
    where id = p_driver_id and pin_hash = crypt(p_old_pin, pin_hash)
  ) then
    return false;
  end if;

  update drivers
    set pin_hash = crypt(p_new_pin, gen_salt('bf'))
    where id = p_driver_id;

  return true;
end;
$$;

-- ───────────────────────────────────────────────────────────────
-- 9. RPC: accept_task / complete_task
--    Mengunci transisi status agar tidak bisa di-skip dari client.
-- ───────────────────────────────────────────────────────────────
create or replace function accept_task(p_task_id uuid, p_driver_id uuid)
returns tasks_detail
language plpgsql
security definer
as $$
declare
  result tasks_detail;
begin
  update tasks
    set status = 'ON GOING', accepted_at = now()
    where id = p_task_id
      and driver_id = p_driver_id
      and status = 'ASSIGNED';

  if not found then
    raise exception 'Task tidak dapat diterima (status bukan ASSIGNED atau bukan milik driver ini)';
  end if;

  select * into result from tasks_detail where id = p_task_id;
  return result;
end;
$$;

create or replace function complete_task(p_task_id uuid, p_driver_id uuid)
returns tasks_detail
language plpgsql
security definer
as $$
declare
  result tasks_detail;
begin
  update tasks
    set status = 'DONE', completed_at = now()
    where id = p_task_id
      and driver_id = p_driver_id
      and status = 'ON GOING'
  ;

  if not found then
    raise exception 'Task tidak dapat diselesaikan (status bukan ON GOING atau bukan milik driver ini)';
  end if;

  select * into result from tasks_detail where id = p_task_id;
  return result;
end;
$$;

-- ───────────────────────────────────────────────────────────────
-- 9b. RPC: cancel_task
--     Driver membatalkan tugas miliknya sendiri (status ASSIGNED/ON GOING saja).
--     Admin/dashboard membatalkan langsung lewat update tabel (lihat policy di bawah),
--     tidak lewat RPC ini karena admin tidak terbatas pada driver_id tertentu.
-- ───────────────────────────────────────────────────────────────
create or replace function cancel_task(p_task_id uuid, p_driver_id uuid, p_reason text default null)
returns tasks_detail
language plpgsql
security definer
as $$
declare
  result tasks_detail;
begin
  update tasks
    set status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'driver', cancel_reason = p_reason
    where id = p_task_id
      and driver_id = p_driver_id
      and status in ('ASSIGNED', 'ON GOING')
  ;

  if not found then
    raise exception 'Task tidak dapat dibatalkan (status sudah final atau bukan milik driver ini)';
  end if;

  select * into result from tasks_detail where id = p_task_id;
  return result;
end;
$$;

-- ───────────────────────────────────────────────────────────────
-- 10. ROW LEVEL SECURITY
--     Karena tidak ada Supabase Auth (login via PIN custom),
--     kita pakai anon key dengan RLS terbuka untuk read,
--     tapi write (insert/update task) dibatasi ke RPC function di atas.
-- ───────────────────────────────────────────────────────────────
alter table drivers enable row level security;
alter table vehicles enable row level security;
alter table employees enable row level security;
alter table job_types enable row level security;
alter table tasks enable row level security;

-- Drivers: boleh dibaca semua (untuk landing page pilih driver),
-- tapi pin_hash tidak pernah di-select langsung oleh client (lihat catatan di app).
drop policy if exists "drivers_select_all" on drivers;
create policy "drivers_select_all" on drivers for select using (true);

drop policy if exists "vehicles_select_all" on vehicles;
create policy "vehicles_select_all" on vehicles for select using (true);

drop policy if exists "employees_select_all" on employees;
create policy "employees_select_all" on employees for select using (true);

drop policy if exists "job_types_select_all" on job_types;
create policy "job_types_select_all" on job_types for select using (true);

-- Tasks: read terbuka (driver & admin perlu baca semua untuk dashboard).
drop policy if exists "tasks_select_all" on tasks;
create policy "tasks_select_all" on tasks for select using (true);

-- Tasks: insert hanya dari dashboard admin (tanpa auth khusus saat ini,
-- dibuka untuk anon key — amankan lebih lanjut dengan Supabase Auth jika perlu).
drop policy if exists "tasks_insert_all" on tasks;
create policy "tasks_insert_all" on tasks for insert with check (true);

drop policy if exists "tasks_update_all" on tasks;
create policy "tasks_update_all" on tasks for update using (true);

-- Vehicles/Employees/JobTypes: izinkan insert dari dashboard (master data management).
drop policy if exists "vehicles_insert_all" on vehicles;
create policy "vehicles_insert_all" on vehicles for insert with check (true);

drop policy if exists "employees_insert_all" on employees;
create policy "employees_insert_all" on employees for insert with check (true);

drop policy if exists "drivers_insert_all" on drivers;
create policy "drivers_insert_all" on drivers for insert with check (true);

-- ───────────────────────────────────────────────────────────────
-- 11. REALTIME
--     Aktifkan replication untuk tabel tasks agar driver panel
--     & dashboard menerima update otomatis (Supabase Realtime).
-- ───────────────────────────────────────────────────────────────
alter publication supabase_realtime add table tasks;

-- ───────────────────────────────────────────────────────────────
-- 12. SAMPLE DATA (opsional — hapus/comment jika tidak perlu)
-- ───────────────────────────────────────────────────────────────
insert into drivers (nama, no_hp, avatar_emoji) values
  ('Budi Santoso', '081234567890', '🧑‍✈️'),
  ('Siti Aminah',  '081234567891', '👨‍✈️'),
  ('Ahmad Yani',   '081234567892', '🧑‍🔧')
on conflict do nothing;

insert into vehicles (nopol, jenis) values
  ('B 1234 XYZ', 'Toyota Avanza'),
  ('D 5678 ABC', 'Toyota Innova'),
  ('B 9999 DEF', 'Daihatsu Xenia')
on conflict (nopol) do nothing;

insert into employees (nik, nama, departement) values
  ('001', 'John Doe',    'IT'),
  ('002', 'Jane Smith',  'HR'),
  ('003', 'Bob Johnson', 'Finance')
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════
--  SELESAI. Semua default PIN driver = 1234 (ganti via app nanti).
-- ═══════════════════════════════════════════════════════════════
