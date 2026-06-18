export type TaskStatus = "ASSIGNED" | "ON GOING" | "DONE" | "CANCELLED";

export interface Driver {
  id: string;
  nama: string;
  no_hp: string | null;
  avatar_emoji: string | null;
  aktif: boolean;
}

export interface Vehicle {
  id: string;
  nopol: string;
  jenis: string | null;
  aktif: boolean;
}

export interface Employee {
  id: string;
  nik: string | null;
  nama: string;
  departement: string | null;
}

export interface JobType {
  id: string;
  label: string;
}

/** Bentuk row dari view `tasks_detail` — sudah join driver & vehicle. */
export interface TaskDetail {
  id: string;
  tanggal: string; // yyyy-mm-dd
  driver_id: string | null;
  driver_nama: string | null;
  driver_avatar: string | null;
  vehicle_id: string | null;
  kendaraan: string | null;
  kendaraan_jenis: string | null;
  jenis_pekerjaan: string;
  tujuan: string;
  requestor: string;
  departement: string | null;
  perihal: string | null;
  status: TaskStatus;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
}

export interface TaskStats {
  total: number;
  assigned: number;
  ongoing: number;
  done: number;
  cancelled: number;
}

export function computeStats(tasks: TaskDetail[]): TaskStats {
  return {
    total: tasks.length,
    assigned: tasks.filter((t) => t.status === "ASSIGNED").length,
    ongoing: tasks.filter((t) => t.status === "ON GOING").length,
    done: tasks.filter((t) => t.status === "DONE").length,
    cancelled: tasks.filter((t) => t.status === "CANCELLED").length,
  };
}

/** Ringkasan performa per driver untuk laporan. */
export interface DriverSummary {
  driverId: string;
  driverNama: string;
  total: number;
  done: number;
  cancelled: number;
  ongoingOrAssigned: number;
  completionRate: number; // 0-100
  avgDurationMinutes: number | null; // rata-rata accepted_at -> completed_at
}

export function computeDriverSummaries(
  tasks: TaskDetail[],
  drivers: Driver[]
): DriverSummary[] {
  const byDriver = new Map<string, TaskDetail[]>();
  for (const t of tasks) {
    if (!t.driver_id) continue;
    const list = byDriver.get(t.driver_id) ?? [];
    list.push(t);
    byDriver.set(t.driver_id, list);
  }

  const summaries: DriverSummary[] = [];
  for (const driver of drivers) {
    const list = byDriver.get(driver.id) ?? [];
    if (list.length === 0) continue;

    const done = list.filter((t) => t.status === "DONE").length;
    const cancelled = list.filter((t) => t.status === "CANCELLED").length;
    const ongoingOrAssigned = list.filter(
      (t) => t.status === "ASSIGNED" || t.status === "ON GOING"
    ).length;

    const durations: number[] = [];
    for (const t of list) {
      if (t.status === "DONE" && t.accepted_at && t.completed_at) {
        const ms =
          new Date(t.completed_at).getTime() -
          new Date(t.accepted_at).getTime();
        if (ms > 0) durations.push(ms / 60000);
      }
    }
    const avgDurationMinutes =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null;

    summaries.push({
      driverId: driver.id,
      driverNama: driver.nama,
      total: list.length,
      done,
      cancelled,
      ongoingOrAssigned,
      completionRate: list.length > 0 ? (done / list.length) * 100 : 0,
      avgDurationMinutes,
    });
  }

  return summaries.sort((a, b) => b.total - a.total);
}
