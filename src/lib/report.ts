import type { Driver, TaskDetail } from "./types";
import { computeDriverSummaries, computeStats } from "./types";

function escapeCsvField(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabelId(status: string): string {
  if (status === "ASSIGNED") return "Baru Ditugaskan";
  if (status === "ON GOING") return "Sedang Berjalan";
  if (status === "CANCELLED") return "Dibatalkan";
  return "Selesai";
}

/* ════════════════════════════════════════════════════════════
   CSV EXPORT
════════════════════════════════════════════════════════════ */

export function exportTasksToCsv(
  tasks: TaskDetail[],
  dateFrom: string,
  dateTo: string
): void {
  const headers = [
    "Tanggal",
    "Driver",
    "Kendaraan",
    "Jenis Kendaraan",
    "Jenis Pekerjaan",
    "Tujuan",
    "Requestor",
    "Departemen",
    "Perihal",
    "Status",
    "Dibuat",
    "Diterima",
    "Selesai",
    "Dibatalkan",
    "Dibatalkan Oleh",
    "Alasan Batal",
  ];

  const rows = tasks.map((t) => [
    t.tanggal,
    t.driver_nama ?? "-",
    t.kendaraan ?? "-",
    t.kendaraan_jenis ?? "-",
    t.jenis_pekerjaan,
    t.tujuan,
    t.requestor,
    t.departement ?? "-",
    t.perihal ?? "-",
    statusLabelId(t.status),
    formatDateTime(t.created_at),
    formatDateTime(t.accepted_at),
    formatDateTime(t.completed_at),
    formatDateTime(t.cancelled_at),
    t.cancelled_by ?? "-",
    t.cancel_reason ?? "-",
  ]);

  const csvLines = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(",")),
  ];

  // BOM agar Excel membuka UTF-8 (karakter Indonesia) dengan benar
  const csvContent = "\uFEFF" + csvLines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `CIKOPS_Report_${dateFrom}_to_${dateTo}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ════════════════════════════════════════════════════════════
   PDF EXPORT — komprehensif: ringkasan + per-driver + detail lengkap
════════════════════════════════════════════════════════════ */

export async function exportTasksToPdf(
  tasks: TaskDetail[],
  drivers: Driver[],
  dateFrom: string,
  dateTo: string
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const autoTableModule = await import("jspdf-autotable");
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;

  const stats = computeStats(tasks);
  const driverSummaries = computeDriverSummaries(tasks, drivers);

  const brandBlue: [number, number, number] = [46, 91, 255];
  const navy: [number, number, number] = [11, 30, 77];
  const gray: [number, number, number] = [100, 110, 130];

  /* ── Header ── */
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageWidth, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("CIKOPS FLEET OPERATIONS", marginX, 30);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("Laporan Penugasan Driver", marginX, 48);
  doc.setFontSize(9);
  doc.text(
    `Periode: ${formatDateOnly(dateFrom)} s/d ${formatDateOnly(dateTo)}`,
    marginX,
    62
  );

  const generatedAt = new Date().toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  doc.setFontSize(8);
  doc.text(`Dibuat: ${generatedAt}`, pageWidth - marginX, 30, {
    align: "right",
  });

  let y = 96;

  /* ── Ringkasan keseluruhan ── */
  doc.setTextColor(...navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Ringkasan Keseluruhan", marginX, y);
  y += 10;

  const summaryCards: Array<[string, number]> = [
    ["Total Tugas", stats.total],
    ["Baru Ditugaskan", stats.assigned],
    ["Sedang Berjalan", stats.ongoing],
    ["Selesai", stats.done],
    ["Dibatalkan", stats.cancelled],
  ];
  const cardWidth = (pageWidth - marginX * 2) / summaryCards.length;
  summaryCards.forEach(([label, value], i) => {
    const x = marginX + i * cardWidth;
    doc.setDrawColor(220, 224, 235);
    doc.setFillColor(247, 249, 253);
    doc.roundedRect(x, y, cardWidth - 8, 46, 4, 4, "FD");
    doc.setTextColor(...brandBlue);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(String(value), x + 12, y + 24);
    doc.setTextColor(...gray);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(label, x + 12, y + 36);
  });
  y += 46 + 26;

  /* ── Ringkasan per driver ── */
  doc.setTextColor(...navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Ringkasan per Driver", marginX, y);
  y += 8;

  const driverRows = driverSummaries.map((s) => [
    s.driverNama,
    String(s.total),
    String(s.done),
    String(s.cancelled),
    String(s.ongoingOrAssigned),
    `${s.completionRate.toFixed(0)}%`,
    s.avgDurationMinutes !== null
      ? `${Math.round(s.avgDurationMinutes)} menit`
      : "-",
  ]);

  autoTable(doc, {
    startY: y + 6,
    margin: { left: marginX, right: marginX },
    head: [
      [
        "Driver",
        "Total",
        "Selesai",
        "Dibatalkan",
        "Aktif",
        "Tingkat Selesai",
        "Durasi Rata-rata",
      ],
    ],
    body: driverRows.length > 0 ? driverRows : [["Tidak ada data", "", "", "", "", "", ""]],
    theme: "grid",
    headStyles: {
      fillColor: brandBlue,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 8.5, textColor: [20, 26, 50] },
    alternateRowStyles: { fillColor: [247, 249, 253] },
  });

  /* ── Detail lengkap semua tugas (halaman baru) ── */
  doc.addPage();
  doc.setTextColor(...navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Detail Lengkap Tugas", marginX, 36);

  const detailRows = tasks.map((t) => [
    t.tanggal,
    t.driver_nama ?? "-",
    t.kendaraan ?? "-",
    t.jenis_pekerjaan,
    t.tujuan,
    `${t.requestor}${t.departement ? ` (${t.departement})` : ""}`,
    statusLabelId(t.status),
    formatDateTime(t.created_at),
    formatDateTime(t.completed_at),
  ]);

  autoTable(doc, {
    startY: 50,
    margin: { left: marginX, right: marginX },
    head: [
      [
        "Tanggal",
        "Driver",
        "Kendaraan",
        "Jenis",
        "Tujuan",
        "Requestor",
        "Status",
        "Dibuat",
        "Selesai",
      ],
    ],
    body:
      detailRows.length > 0
        ? detailRows
        : [["Tidak ada tugas pada periode ini", "", "", "", "", "", "", "", ""]],
    theme: "grid",
    headStyles: {
      fillColor: navy,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
    },
    bodyStyles: { fontSize: 7.5, textColor: [20, 26, 50] },
    alternateRowStyles: { fillColor: [247, 249, 253] },
    styles: { overflow: "linebreak" },
    columnStyles: {
      4: { cellWidth: 110 },
      5: { cellWidth: 90 },
    },
  });

  /* ── Footer di setiap halaman ── */
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...gray);
    doc.text(
      `CIKOPS Fleet OS — Halaman ${i} dari ${pageCount}`,
      marginX,
      doc.internal.pageSize.getHeight() - 18
    );
  }

  doc.save(`CIKOPS_Report_${dateFrom}_to_${dateTo}.pdf`);
}

function formatDateOnly(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}
