"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./dashboard.module.css";
import {
  cancelTaskByAdmin,
  createTask,
  deleteTask,
  getDrivers,
  getEmployees,
  getJobTypes,
  getTasksByDate,
  getTasksByRange,
  getVehicles,
  subscribeToTasks,
  updateTaskStatus,
} from "@/lib/api";
import { exportTasksToCsv, exportTasksToPdf } from "@/lib/report";
import { computeReportAnalytics, formatMinutes } from "@/lib/analytics";
import type {
  Driver,
  Employee,
  JobType,
  TaskDetail,
  TaskStatus,
  Vehicle,
} from "@/lib/types";
import { computeStats } from "@/lib/types";

type Theme = "dark" | "light";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

/** Hook sederhana untuk deteksi viewport mobile vs desktop, dipakai untuk
 *  memilih presentasi yang berbeda (tabel di PC, kartu di HP) dari data yang sama. */
function useIsMobile(breakpoint = 860) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < breakpoint);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);

  return isMobile;
}

export default function DashboardPage() {
  const [theme, setTheme] = useState<Theme>("light");
  const isMobile = useIsMobile();

  const [dateFilter, setDateFilter] = useState(todayStr());
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null);
  const [search, setSearch] = useState("");

  const [tasks, setTasks] = useState<TaskDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<TaskDetail | null>(null);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(
    null
  );

  useEffect(() => {
    const saved = localStorage.getItem("cikops_theme") as Theme | null;
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [theme]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("cikops_theme", next);
  }

  function showToast(msg: string, isError = false) {
    setToast({ msg, error: isError });
    setTimeout(() => setToast(null), 2500);
  }

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTasksByDate(dateFilter);
      setTasks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data tugas");
    } finally {
      setLoading(false);
    }
  }, [dateFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const unsubscribe = subscribeToTasks(() => {
      loadTasks();
    });
    return unsubscribe;
  }, [loadTasks]);

  // load master data once (for the create-task form)
  useEffect(() => {
    (async () => {
      try {
        const [d, v, e, j] = await Promise.all([
          getDrivers(),
          getVehicles(),
          getEmployees(),
          getJobTypes(),
        ]);
        setDrivers(d);
        setVehicles(v);
        setEmployees(e);
        setJobTypes(j);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Gagal memuat master data",
          true
        );
      }
    })();
  }, []);

  const stats = useMemo(() => computeStats(tasks), [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (statusFilter) {
      result = result.filter((t) => t.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.tujuan?.toLowerCase().includes(q) ||
          t.driver_nama?.toLowerCase().includes(q) ||
          t.requestor?.toLowerCase().includes(q) ||
          t.kendaraan?.toLowerCase().includes(q) ||
          t.jenis_pekerjaan?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [tasks, statusFilter, search]);

  async function handleStatusChange(task: TaskDetail, status: TaskStatus) {
    try {
      await updateTaskStatus(task.id, status);
      showToast(`Status diubah ke ${status}`);
      loadTasks();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Gagal mengubah status", true);
    }
  }

  async function handleDelete(task: TaskDetail) {
    if (!confirm(`Hapus tugas ke "${task.tujuan}"?`)) return;
    try {
      await deleteTask(task.id);
      showToast("Tugas dihapus");
      loadTasks();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Gagal menghapus tugas", true);
    }
  }

  function openCancelConfirm(task: TaskDetail) {
    setCancelTarget(task);
  }

  async function handleCancelConfirmed() {
    if (!cancelTarget) return;
    const task = cancelTarget;
    setCancelTarget(null);
    try {
      await cancelTaskByAdmin(task.id);
      showToast("Tugas dibatalkan");
      loadTasks();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Gagal membatalkan tugas", true);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <img src="/logo.svg" alt="CIKOPS" className={styles.topbarLogoImg} />
        <div className={styles.topbarTitleWrap}>
          <div className={styles.topbarEyebrow}>CIKOPS</div>
          <div className={styles.topbarTitle}>Fleet Dashboard</div>
        </div>
        <div className={styles.topbarActions}>
          {!isMobile && (
            <div className={styles.liveBadge}>
              <span className={styles.liveDot} /> Live
            </div>
          )}
          <button className={styles.iconBtn} onClick={toggleTheme}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => setReportModalOpen(true)}
            aria-label="Laporan & Analytics"
            title="Laporan & Analytics"
          >
            📊
          </button>
          <button className={styles.btnPrimary} onClick={() => setModalOpen(true)}>
            {isMobile ? "+ Tugaskan" : "+ Tugaskan Driver"}
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.statsRow}>
          <div className={`${styles.statCard} ${styles.statTotal}`}>
            <div className={styles.statCardTop}>
              <span className={styles.statCardIcon}>📊</span>
            </div>
            <div className={styles.statCardNum}>{stats.total}</div>
            <div className={styles.statCardLabel}>Total Tugas</div>
          </div>
          <div className={`${styles.statCard} ${styles.statAssigned}`}>
            <div className={styles.statCardTop}>
              <span className={styles.statCardIcon}>🆕</span>
            </div>
            <div className={styles.statCardNum}>{stats.assigned}</div>
            <div className={styles.statCardLabel}>Baru Ditugaskan</div>
          </div>
          <div className={`${styles.statCard} ${styles.statOngoing}`}>
            <div className={styles.statCardTop}>
              <span className={styles.statCardIcon}>🚗</span>
            </div>
            <div className={styles.statCardNum}>{stats.ongoing}</div>
            <div className={styles.statCardLabel}>Sedang Berjalan</div>
          </div>
          <div className={`${styles.statCard} ${styles.statDone}`}>
            <div className={styles.statCardTop}>
              <span className={styles.statCardIcon}>✅</span>
            </div>
            <div className={styles.statCardNum}>{stats.done}</div>
            <div className={styles.statCardLabel}>Selesai</div>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolbarDate}>
            <span>📅</span>
            <input
              type="date"
              className={styles.toolbarDateInput}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>

          <div className={styles.toolbarStatusGroup}>
            {(["ASSIGNED", "ON GOING", "DONE", "CANCELLED"] as TaskStatus[]).map(
              (s) => (
                <button
                  key={s}
                  className={`${styles.statusChip} ${
                    statusFilter === s ? styles.statusChipOn : ""
                  }`}
                  onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                >
                  {s}
                </button>
              )
            )}
          </div>

          {!isMobile && <div className={styles.toolbarSpacer} />}

          <div className={styles.searchBox}>
            <span>🔎</span>
            <input
              className={styles.searchInput}
              placeholder="Cari tujuan, driver, requestor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {error && <div className={styles.errBanner}>{error}</div>}

        {loading ? (
          <div className={styles.tableWrap}>
            <div className={styles.tableLoading}>
              <div className={styles.spinner} />
              <div className={styles.loadingTxt}>Memuat data tugas...</div>
            </div>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className={styles.tableWrap}>
            <div className={styles.tableEmpty}>
              <span className={styles.tableEmptyIco}>🗂️</span>
              <div className={styles.tableEmptyTitle}>
                Tidak ada tugas untuk filter ini
              </div>
            </div>
          </div>
        ) : isMobile ? (
          <MobileTaskList
            tasks={filteredTasks}
            onAdvance={handleStatusChange}
            onCancel={openCancelConfirm}
            onDelete={handleDelete}
          />
        ) : (
          <DesktopTaskTable
            tasks={filteredTasks}
            onAdvance={handleStatusChange}
            onCancel={openCancelConfirm}
            onDelete={handleDelete}
          />
        )}
      </div>

      {modalOpen && (
        <CreateTaskModal
          drivers={drivers}
          vehicles={vehicles}
          employees={employees}
          jobTypes={jobTypes}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            showToast("Tugas berhasil ditugaskan ✓");
            loadTasks();
          }}
          onError={(msg) => showToast(msg, true)}
        />
      )}

      {reportModalOpen && (
        <ReportModal
          drivers={drivers}
          onClose={() => setReportModalOpen(false)}
          onError={(msg) => showToast(msg, true)}
          onSuccess={(msg) => showToast(msg)}
        />
      )}

      {cancelTarget && (
        <div
          className={styles.modalOverlay}
          onClick={() => setCancelTarget(null)}
        >
          <div
            className={styles.confirmBox}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalTitle}>Batalkan tugas ini?</div>
            <div className={styles.confirmSub}>
              Tujuan: {cancelTarget.tujuan} · Driver:{" "}
              {cancelTarget.driver_nama || "-"}
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnCancel}
                onClick={() => setCancelTarget(null)}
              >
                Tidak
              </button>
              <button
                className={styles.btnDangerConfirm}
                onClick={handleCancelConfirmed}
              >
                Ya, Batalkan
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.error ? styles.toastError : ""}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  const cls =
    status === "ASSIGNED"
      ? styles.pillAssigned
      : status === "ON GOING"
      ? styles.pillOngoing
      : status === "CANCELLED"
      ? styles.pillCancelled
      : styles.pillDone;
  return <span className={`${styles.statusPill} ${cls}`}>{status}</span>;
}

/* ════════════════════════════════════════════════
   DESKTOP: tabel lebar dengan scroll horizontal
════════════════════════════════════════════════ */

function DesktopTaskTable({
  tasks,
  onAdvance,
  onCancel,
  onDelete,
}: {
  tasks: TaskDetail[];
  onAdvance: (t: TaskDetail, status: TaskStatus) => void;
  onCancel: (t: TaskDetail) => void;
  onDelete: (t: TaskDetail) => void;
}) {
  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Driver</th>
              <th>Kendaraan</th>
              <th>Tujuan</th>
              <th>Jenis Pekerjaan</th>
              <th>Requestor</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className={styles.cellMuted}>
                  {new Date(t.created_at).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className={styles.cellBold}>
                  {t.driver_avatar} {t.driver_nama || "-"}
                </td>
                <td>{t.kendaraan || "-"}</td>
                <td className={styles.cellBold}>{t.tujuan}</td>
                <td>{t.jenis_pekerjaan}</td>
                <td>
                  {t.requestor}
                  {t.departement ? ` (${t.departement})` : ""}
                </td>
                <td>
                  <StatusPill status={t.status} />
                </td>
                <td>
                  <div className={styles.rowActions}>
                    {t.status !== "DONE" && t.status !== "CANCELLED" && (
                      <button
                        className={styles.rowActionBtn}
                        onClick={() =>
                          onAdvance(
                            t,
                            t.status === "ASSIGNED" ? "ON GOING" : "DONE"
                          )
                        }
                      >
                        {t.status === "ASSIGNED" ? "→ Proses" : "→ Selesai"}
                      </button>
                    )}
                    {t.status !== "DONE" && t.status !== "CANCELLED" && (
                      <button
                        className={`${styles.rowActionBtn} ${styles.rowActionWarn}`}
                        onClick={() => onCancel(t)}
                      >
                        Batalkan
                      </button>
                    )}
                    <button
                      className={`${styles.rowActionBtn} ${styles.rowActionDanger}`}
                      onClick={() => onDelete(t)}
                    >
                      Hapus
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════
   MOBILE: kartu vertikal, tanpa scroll horizontal
════════════════════════════════════════════════ */

function MobileTaskList({
  tasks,
  onAdvance,
  onCancel,
  onDelete,
}: {
  tasks: TaskDetail[];
  onAdvance: (t: TaskDetail, status: TaskStatus) => void;
  onCancel: (t: TaskDetail) => void;
  onDelete: (t: TaskDetail) => void;
}) {
  return (
    <div className={styles.mobileList}>
      {tasks.map((t) => (
        <div key={t.id} className={styles.mobileCard}>
          <div className={styles.mobileCardTop}>
            <div className={styles.mobileCardDest}>{t.tujuan}</div>
            <StatusPill status={t.status} />
          </div>
          <div className={styles.mobileCardMeta}>
            <span>
              {t.driver_avatar} {t.driver_nama || "-"}
            </span>
            <span className={styles.mobileCardDot}>•</span>
            <span>{t.kendaraan || "-"}</span>
          </div>
          <div className={styles.mobileCardSub}>
            {t.jenis_pekerjaan} · {t.requestor}
            {t.departement ? ` (${t.departement})` : ""}
          </div>
          <div className={styles.mobileCardTime}>
            {new Date(t.created_at).toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <div className={styles.mobileCardActions}>
            {t.status !== "DONE" && t.status !== "CANCELLED" && (
              <button
                className={styles.mobileActionBtn}
                onClick={() =>
                  onAdvance(t, t.status === "ASSIGNED" ? "ON GOING" : "DONE")
                }
              >
                {t.status === "ASSIGNED" ? "→ Proses" : "→ Selesai"}
              </button>
            )}
            {t.status !== "DONE" && t.status !== "CANCELLED" && (
              <button
                className={`${styles.mobileActionBtn} ${styles.mobileActionWarn}`}
                onClick={() => onCancel(t)}
              >
                Batalkan
              </button>
            )}
            <button
              className={`${styles.mobileActionBtn} ${styles.mobileActionDanger}`}
              onClick={() => onDelete(t)}
            >
              Hapus
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════
   REPORT MODAL — pilih rentang tanggal, unduh CSV/PDF
════════════════════════════════════════════════ */

type QuickRange = "today" | "7d" | "14d" | "30d" | "3m" | "thisMonth";

function quickRangeToDates(range: QuickRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (range === "today") {
    // from = to
  } else if (range === "7d") {
    from.setDate(from.getDate() - 6);
  } else if (range === "14d") {
    from.setDate(from.getDate() - 13);
  } else if (range === "30d") {
    from.setDate(from.getDate() - 29);
  } else if (range === "3m") {
    from.setMonth(from.getMonth() - 3);
  } else if (range === "thisMonth") {
    from.setDate(1);
  }
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { from: fmt(from), to: fmt(to) };
}

function ReportModal({
  drivers,
  onClose,
  onError,
  onSuccess,
}: {
  drivers: Driver[];
  onClose: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const [quickRange, setQuickRange] = useState<QuickRange>("7d");
  const [dateFrom, setDateFrom] = useState(quickRangeToDates("7d").from);
  const [dateTo, setDateTo] = useState(quickRangeToDates("7d").to);
  const [busy, setBusy] = useState<"csv" | "pdf" | null>(null);
  const [reportTasks, setReportTasks] = useState<TaskDetail[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoadingPreview(true);
    try {
      const data = await getTasksByRange(dateFrom, dateTo);
      setReportTasks(data);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Gagal memuat data laporan");
    } finally {
      setLoadingPreview(false);
    }
  }, [dateFrom, dateTo, onError]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  function applyQuickRange(range: QuickRange) {
    setQuickRange(range);
    const { from, to } = quickRangeToDates(range);
    setDateFrom(from);
    setDateTo(to);
  }

  const analytics = useMemo(
    () => computeReportAnalytics(reportTasks, drivers),
    [reportTasks, drivers]
  );

  async function handleDownload(format: "csv" | "pdf") {
    if (!dateFrom || !dateTo) {
      onError("Pilih rentang tanggal terlebih dahulu");
      return;
    }
    setBusy(format);
    try {
      const tasks =
        reportTasks.length > 0 || !loadingPreview
          ? reportTasks
          : await getTasksByRange(dateFrom, dateTo);
      if (format === "csv") {
        exportTasksToCsv(tasks, dateFrom, dateTo);
      } else {
        await exportTasksToPdf(tasks, drivers, dateFrom, dateTo);
      }
      onSuccess(
        `Laporan ${format.toUpperCase()} berhasil diunduh (${tasks.length} tugas)`
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Gagal membuat laporan");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.reportOverlay}>
      <div className={styles.reportPanel}>
        <div className={styles.reportTopbar}>
          <div className={styles.reportTitleWrap}>
            <div className={styles.topbarEyebrow}>CIKOPS</div>
            <div className={styles.topbarTitle}>Laporan & Analytics</div>
          </div>
          <button className={styles.modalClose} onClick={onClose}>
            ✕ Tutup
          </button>
        </div>

        <div className={styles.reportBody}>
          <div className={styles.reportFilterRow}>
            <div className={styles.toolbarDate}>
              <span>📅</span>
              <input
                type="date"
                className={styles.toolbarDateInput}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <span className={styles.reportRangeDash}>s/d</span>
            <div className={styles.toolbarDate}>
              <input
                type="date"
                className={styles.toolbarDateInput}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div className={styles.reportQuickChips}>
              {(
                [
                  ["today", "Hari Ini"],
                  ["7d", "7 Hari"],
                  ["14d", "14 Hari"],
                  ["30d", "30 Hari"],
                  ["3m", "3 Bulan"],
                  ["thisMonth", "Bulan Ini"],
                ] as [QuickRange, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`${styles.statusChip} ${
                    quickRange === key ? styles.statusChipOn : ""
                  }`}
                  onClick={() => applyQuickRange(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.reportActionRow}>
            <button
              className={styles.btnReportCsv}
              disabled={busy !== null || loadingPreview}
              onClick={() => handleDownload("csv")}
            >
              {busy === "csv" ? "Menyiapkan..." : "⬇ Export CSV"}
            </button>
            <button
              className={styles.btnSubmit}
              disabled={busy !== null || loadingPreview}
              onClick={() => handleDownload("pdf")}
            >
              {busy === "pdf" ? "Menyiapkan..." : "⬇ Export PDF"}
            </button>
          </div>

          {loadingPreview ? (
            <div className={styles.tableWrap}>
              <div className={styles.tableLoading}>
                <div className={styles.spinner} />
                <div className={styles.loadingTxt}>Memuat data laporan...</div>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.statsRow}>
                <div className={`${styles.statCard} ${styles.statTotal}`}>
                  <div className={styles.statCardNum}>{analytics.totalTask}</div>
                  <div className={styles.statCardLabel}>Total Task</div>
                </div>
                <div className={`${styles.statCard} ${styles.statAssigned}`}>
                  <div className={styles.statCardNum}>{analytics.assigned}</div>
                  <div className={styles.statCardLabel}>Assigned</div>
                </div>
                <div className={`${styles.statCard} ${styles.statOngoing}`}>
                  <div className={styles.statCardNum}>{analytics.ongoing}</div>
                  <div className={styles.statCardLabel}>On Going</div>
                </div>
                <div className={`${styles.statCard} ${styles.statDone}`}>
                  <div className={styles.statCardNum}>{analytics.done}</div>
                  <div className={styles.statCardLabel}>Done</div>
                </div>
                <div className={`${styles.statCard} ${styles.statDriverAktif}`}>
                  <div className={styles.statCardNum}>
                    {analytics.driverAktif}
                  </div>
                  <div className={styles.statCardLabel}>Driver Aktif</div>
                </div>
                <div className={`${styles.statCard} ${styles.statCompletion}`}>
                  <div className={styles.statCardNum}>
                    {analytics.completionRate.toFixed(0)}%
                  </div>
                  <div className={styles.statCardLabel}>Completion Rate</div>
                </div>
              </div>

              <div className={styles.reportSectionHeader}>
                <span className={styles.reportSectionIco}>📊</span>
                Analytics & Insights
              </div>

              <div className={styles.insightGrid}>
                <InsightCard
                  icon="🏆"
                  title="Top Driver (Task)"
                  entries={analytics.topDriverByTask}
                  color="blue"
                />
                <InsightCard
                  icon="⏱️"
                  title="Rata-rata Durasi Driver"
                  entries={analytics.avgDurationByDriver}
                  color="cyan"
                  valueFormatter={(v) => formatMinutes(v)}
                />
                <InsightCard
                  icon="🏢"
                  title="Top Departemen Requestor"
                  entries={analytics.topDepartementRequestor}
                  color="purple"
                />
                <InsightCard
                  icon="🧰"
                  title="Jenis Pekerjaan Terbanyak"
                  entries={analytics.topJenisPekerjaan}
                  color="green"
                />
                <InsightCard
                  icon="🚗"
                  title="Utilisasi Kendaraan"
                  entries={analytics.utilisasiKendaraan}
                  color="orange"
                />
                <InsightCard
                  icon="📅"
                  title="Aktivitas Harian"
                  entries={analytics.aktivitasHarian.map((e) => ({
                    ...e,
                    label: formatDateLabel(e.label),
                  }))}
                  color="red"
                />
              </div>

              <div className={styles.reportSectionHeader}>
                <span className={styles.reportSectionIco}>👥</span>
                Ringkasan Per Driver
                <span className={styles.reportSectionCount}>
                  {analytics.driverSummaries.length} driver
                </span>
              </div>

              <div className={styles.driverSummaryGrid}>
                {analytics.driverSummaries.length === 0 ? (
                  <div className={styles.tableEmpty}>
                    <div className={styles.tableEmptyTitle}>
                      Tidak ada data driver pada periode ini
                    </div>
                  </div>
                ) : (
                  analytics.driverSummaries.map((s) => (
                    <div key={s.driverId} className={styles.driverSummaryCard}>
                      <div className={styles.driverSummaryHeader}>
                        <span>🏅</span> {s.driverNama}
                      </div>
                      <div className={styles.driverSummaryPeriod}>
                        {formatDateLabel(dateFrom)} s/d {formatDateLabel(dateTo)}
                      </div>
                      <div className={styles.driverSummaryRow}>
                        <span>Total Task</span>
                        <strong>{s.totalTask}</strong>
                      </div>
                      <div className={styles.driverSummaryRow}>
                        <span>Selesai</span>
                        <strong>{s.selesai}</strong>
                      </div>
                      <div className={styles.driverSummaryRow}>
                        <span>Completion Rate</span>
                        <strong className={styles.driverSummaryAccent}>
                          {s.completionRate.toFixed(0)}%
                        </strong>
                      </div>
                      <div className={styles.driverSummaryRow}>
                        <span>Total Jam Kerja</span>
                        <strong className={styles.driverSummaryAccentBlue}>
                          {formatMinutes(s.totalJamKerjaMinutes)}
                        </strong>
                      </div>
                      <div className={styles.driverSummaryRow}>
                        <span>Avg Durasi/Task</span>
                        <strong className={styles.driverSummaryAccentBlue}>
                          {s.avgDurationMinutes !== null
                            ? formatMinutes(s.avgDurationMinutes)
                            : "-"}
                        </strong>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

const INSIGHT_COLOR_CLASS: Record<string, string> = {
  blue: "insightBarBlue",
  cyan: "insightBarCyan",
  purple: "insightBarPurple",
  green: "insightBarGreen",
  orange: "insightBarOrange",
  red: "insightBarRed",
};

function InsightCard({
  icon,
  title,
  entries,
  color,
  valueFormatter,
}: {
  icon: string;
  title: string;
  entries: { label: string; value: number }[];
  color: string;
  valueFormatter?: (v: number) => string;
}) {
  const maxValue = Math.max(...entries.map((e) => e.value), 1);
  const barClass =
    styles[INSIGHT_COLOR_CLASS[color] as keyof typeof styles] || "";
  return (
    <div className={styles.insightCard}>
      <div className={styles.insightCardHeader}>
        <span>{icon}</span> {title}
      </div>
      {entries.length === 0 ? (
        <div className={styles.insightEmpty}>Tidak ada data</div>
      ) : (
        <div className={styles.insightList}>
          {entries.slice(0, 5).map((e) => (
            <div key={e.label} className={styles.insightRow}>
              <div className={styles.insightLabel} title={e.label}>
                {e.label}
              </div>
              <div className={styles.insightBarTrack}>
                <div
                  className={`${styles.insightBarFill} ${barClass}`}
                  style={{ width: `${(e.value / maxValue) * 100}%` }}
                />
              </div>
              <div className={styles.insightValue}>
                {valueFormatter ? valueFormatter(e.value) : e.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════
   CREATE TASK MODAL
════════════════════════════════════════════════ */

function CreateTaskModal({
  drivers,
  vehicles,
  employees,
  jobTypes,
  onClose,
  onCreated,
  onError,
}: {
  drivers: Driver[];
  vehicles: Vehicle[];
  employees: Employee[];
  jobTypes: JobType[];
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [tanggal, setTanggal] = useState(todayStr());
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [jenisPekerjaan, setJenisPekerjaan] = useState("");
  const [tujuan, setTujuan] = useState("");
  const [requestor, setRequestor] = useState("");
  const [departement, setDepartement] = useState("");
  const [perihal, setPerihal] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  function handleRequestorPick(name: string) {
    setRequestor(name);
    const emp = employees.find((e) => e.nama === name);
    if (emp?.departement) setDepartement(emp.departement);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!driverId || !vehicleId || !jenisPekerjaan || !tujuan || !requestor) {
      setFormError("Lengkapi semua field wajib (bertanda *)");
      return;
    }

    setBusy(true);
    try {
      await createTask({
        tanggal,
        driver_id: driverId,
        vehicle_id: vehicleId,
        jenis_pekerjaan: jenisPekerjaan,
        tujuan,
        requestor,
        departement,
        perihal,
      });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Gagal membuat tugas");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Tugaskan Driver</div>
          <button className={styles.modalClose} onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.formGrid}>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Tanggal *</label>
              <input
                type="date"
                className={styles.formInput}
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
              />
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Driver *</label>
              <select
                className={styles.formSelect}
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              >
                <option value="">Pilih driver</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nama}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Kendaraan *</label>
              <select
                className={styles.formSelect}
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">Pilih kendaraan</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nopol} {v.jenis ? `(${v.jenis})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Jenis Pekerjaan *</label>
              <select
                className={styles.formSelect}
                value={jenisPekerjaan}
                onChange={(e) => setJenisPekerjaan(e.target.value)}
              >
                <option value="">Pilih jenis</option>
                {jobTypes.map((j) => (
                  <option key={j.id} value={j.label}>
                    {j.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={`${styles.formField} ${styles.formFieldFull}`}>
              <label className={styles.formLabel}>Tujuan *</label>
              <input
                type="text"
                className={styles.formInput}
                placeholder="Contoh: Kantor Cabang Selatan"
                value={tujuan}
                onChange={(e) => setTujuan(e.target.value)}
              />
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Requestor *</label>
              <select
                className={styles.formSelect}
                value={requestor}
                onChange={(e) => handleRequestorPick(e.target.value)}
              >
                <option value="">Pilih pegawai</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.nama}>
                    {emp.nama}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Departemen</label>
              <input
                type="text"
                className={styles.formInput}
                placeholder="Otomatis terisi"
                value={departement}
                onChange={(e) => setDepartement(e.target.value)}
              />
            </div>

            <div className={`${styles.formField} ${styles.formFieldFull}`}>
              <label className={styles.formLabel}>Perihal (opsional)</label>
              <textarea
                className={styles.formTextarea}
                placeholder="Catatan tambahan untuk driver..."
                value={perihal}
                onChange={(e) => setPerihal(e.target.value)}
              />
            </div>
          </div>

          {formError && <div className={styles.formError}>{formError}</div>}

          <div className={styles.modalActions}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>
              Batal
            </button>
            <button type="submit" className={styles.btnSubmit} disabled={busy}>
              {busy ? "Menyimpan..." : "Tugaskan Driver"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
