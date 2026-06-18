-- ═══════════════════════════════════════════════════════════════
--  MIGRATION: tambah fitur Cancel Job
--  Jalankan ini HANYA JIKA database Supabase kamu sudah pernah
--  menjalankan schema.sql versi lama (tanpa status CANCELLED).
--  Jika ini setup baru, cukup jalankan schema.sql saja — migration
--  ini sudah termasuk di dalamnya, tidak perlu dijalankan lagi.
--
--  Aman dijalankan berkali-kali (idempotent).
-- ═══════════════════════════════════════════════════════════════

-- 1. Tambah kolom baru untuk tracking pembatalan
alter table tasks add column if not exists cancelled_at timestamptz;
alter table tasks add column if not exists cancelled_by text;
alter table tasks add column if not exists cancel_reason text;

-- 2. Update CHECK constraint agar 'CANCELLED' menjadi status yang valid
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('ASSIGNED', 'ON GOING', 'DONE', 'CANCELLED'));

-- 3. Update view tasks_detail agar menyertakan kolom baru
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

-- 4. RPC baru: cancel_task (driver membatalkan tugas miliknya sendiri)
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

-- Selesai. Driver & dashboard sekarang bisa membatalkan tugas.
