import type { Driver, TaskDetail } from "./types";

/* ════════════════════════════════════════════════════════════
   Tipe data hasil agregasi, dipakai bersama oleh dashboard
   (tampilan di halaman) dan report.ts (generate PDF) agar
   keduanya selalu menunjukkan angka yang identik.
════════════════════════════════════════════════════════════ */

export interface RankedEntry {
  label: string;
  value: number;
  sublabel?: string;
}

export interface ReportAnalytics {
  totalTask: number;
  assigned: number;
  ongoing: number;
  done: number;
  cancelled: number;
  driverAktif: number;
  completionRate: number; // 0-100, dihitung dari done / (total - cancelled)

  topDriverByTask: RankedEntry[]; // jumlah task per driver
  avgDurationByDriver: RankedEntry[]; // rata-rata menit pengerjaan per driver
  topDepartementRequestor: RankedEntry[];
  topJenisPekerjaan: RankedEntry[];
  utilisasiKendaraan: RankedEntry[]; // jumlah pemakaian per nopol
  aktivitasHarian: RankedEntry[]; // jumlah task per tanggal, urut tanggal naik

  driverSummaries: DriverReportSummary[];
}

export interface DriverReportSummary {
  driverId: string;
  driverNama: string;
  totalTask: number;
  selesai: number;
  dibatalkan: number;
  aktif: number; // assigned + ongoing
  completionRate: number; // 0-100
  totalJamKerjaMinutes: number; // total durasi accepted->completed
  avgDurationMinutes: number | null;
}

function topN(map: Map<string, number>, n: number): RankedEntry[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, value]) => ({ label, value }));
}

export function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h <= 0) return `${m}m`;
  return `${h}j ${m}m`;
}

export function computeReportAnalytics(
  tasks: TaskDetail[],
  drivers: Driver[]
): ReportAnalytics {
  const assigned = tasks.filter((t) => t.status === "ASSIGNED").length;
  const ongoing = tasks.filter((t) => t.status === "ON GOING").length;
  const done = tasks.filter((t) => t.status === "DONE").length;
  const cancelled = tasks.filter((t) => t.status === "CANCELLED").length;
  const totalTask = tasks.length;

  const activeDriverIds = new Set(
    tasks.filter((t) => t.driver_id).map((t) => t.driver_id as string)
  );
  const driverAktif = activeDriverIds.size;

  const nonCancelled = totalTask - cancelled;
  const completionRate = nonCancelled > 0 ? (done / nonCancelled) * 100 : 0;

  /* ── Top driver by task count ── */
  const driverTaskCount = new Map<string, number>();
  for (const t of tasks) {
    if (!t.driver_nama) continue;
    driverTaskCount.set(
      t.driver_nama,
      (driverTaskCount.get(t.driver_nama) ?? 0) + 1
    );
  }
  const topDriverByTask = topN(driverTaskCount, 8);

  /* ── Rata-rata durasi per driver (hanya task DONE dengan accepted+completed) ── */
  const driverDurations = new Map<string, number[]>();
  for (const t of tasks) {
    if (
      t.status === "DONE" &&
      t.driver_nama &&
      t.accepted_at &&
      t.completed_at
    ) {
      const ms =
        new Date(t.completed_at).getTime() - new Date(t.accepted_at).getTime();
      if (ms > 0) {
        const list = driverDurations.get(t.driver_nama) ?? [];
        list.push(ms / 60000);
        driverDurations.set(t.driver_nama, list);
      }
    }
  }
  const avgDurationByDriver: RankedEntry[] = Array.from(
    driverDurations.entries()
  )
    .map(([label, durations]) => ({
      label,
      value: Math.round(
        durations.reduce((a, b) => a + b, 0) / durations.length
      ),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  /* ── Top departemen requestor ── */
  const deptCount = new Map<string, number>();
  for (const t of tasks) {
    const dept = t.departement?.trim();
    if (!dept) continue;
    deptCount.set(dept, (deptCount.get(dept) ?? 0) + 1);
  }
  const topDepartementRequestor = topN(deptCount, 6);

  /* ── Jenis pekerjaan terbanyak ── */
  const jobCount = new Map<string, number>();
  for (const t of tasks) {
    if (!t.jenis_pekerjaan) continue;
    jobCount.set(t.jenis_pekerjaan, (jobCount.get(t.jenis_pekerjaan) ?? 0) + 1);
  }
  const topJenisPekerjaan = topN(jobCount, 6);

  /* ── Utilisasi kendaraan ── */
  const vehicleCount = new Map<string, number>();
  for (const t of tasks) {
    if (!t.kendaraan) continue;
    vehicleCount.set(t.kendaraan, (vehicleCount.get(t.kendaraan) ?? 0) + 1);
  }
  const utilisasiKendaraan = topN(vehicleCount, 8);

  /* ── Aktivitas harian (urut tanggal naik, bukan diurutkan by value) ── */
  const dailyCount = new Map<string, number>();
  for (const t of tasks) {
    dailyCount.set(t.tanggal, (dailyCount.get(t.tanggal) ?? 0) + 1);
  }
  const aktivitasHarian: RankedEntry[] = Array.from(dailyCount.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, value]) => ({ label, value }));

  /* ── Ringkasan lengkap per driver ── */
  const byDriverId = new Map<string, TaskDetail[]>();
  for (const t of tasks) {
    if (!t.driver_id) continue;
    const list = byDriverId.get(t.driver_id) ?? [];
    list.push(t);
    byDriverId.set(t.driver_id, list);
  }
  const driverSummaries: DriverReportSummary[] = [];
  for (const driver of drivers) {
    const list = byDriverId.get(driver.id) ?? [];
    if (list.length === 0) continue;

    const selesai = list.filter((t) => t.status === "DONE").length;
    const dibatalkan = list.filter((t) => t.status === "CANCELLED").length;
    const aktif = list.filter(
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
    const totalJamKerjaMinutes = durations.reduce((a, b) => a + b, 0);
    const avgDurationMinutes =
      durations.length > 0 ? totalJamKerjaMinutes / durations.length : null;

    const nonCancelledForDriver = list.length - dibatalkan;

    driverSummaries.push({
      driverId: driver.id,
      driverNama: driver.nama,
      totalTask: list.length,
      selesai,
      dibatalkan,
      aktif,
      completionRate:
        nonCancelledForDriver > 0
          ? (selesai / nonCancelledForDriver) * 100
          : 0,
      totalJamKerjaMinutes,
      avgDurationMinutes,
    });
  }
  driverSummaries.sort((a, b) => b.totalTask - a.totalTask);

  return {
    totalTask,
    assigned,
    ongoing,
    done,
    cancelled,
    driverAktif,
    completionRate,
    topDriverByTask,
    avgDurationByDriver,
    topDepartementRequestor,
    topJenisPekerjaan,
    utilisasiKendaraan,
    aktivitasHarian,
    driverSummaries,
  };
}
