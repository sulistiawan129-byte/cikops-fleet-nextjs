import type { Driver, TaskDetail } from "./types";
import { computeReportAnalytics, formatMinutes } from "./analytics";
import type { RankedEntry } from "./analytics";

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

function formatDateOnly(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function statusLabelId(status: string): string {
  if (status === "ASSIGNED") return "Baru Ditugaskan";
  if (status === "ON GOING") return "Sedang Berjalan";
  if (status === "CANCELLED") return "Dibatalkan";
  return "Selesai";
}

/* ════════════════════════════════════════════════════════════
   CSV EXPORT — tidak berubah, data mentah lengkap
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
   PDF EXPORT — laporan profesional & komprehensif:
   1. Ringkasan keseluruhan (stat cards)
   2. Analytics & Insights (bar chart per kategori)
   3. Ringkasan per driver (tabel performa)
   4. Detail lengkap setiap tugas
════════════════════════════════════════════════════════════ */

type RGB = [number, number, number];

const COLOR_NAVY: RGB = [11, 30, 77];
const COLOR_BRAND: RGB = [46, 91, 255];
const COLOR_NEON: RGB = [0, 194, 255];
const COLOR_GREEN: RGB = [0, 184, 107];
const COLOR_ORANGE: RGB = [255, 138, 0];
const COLOR_RED: RGB = [255, 59, 92];
const COLOR_PURPLE: RGB = [124, 92, 255];
const COLOR_GRAY: RGB = [100, 110, 130];
const COLOR_LIGHT_BG: RGB = [247, 249, 253];
const COLOR_LIGHT_BORDER: RGB = [222, 227, 240];

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
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const contentWidth = pageWidth - marginX * 2;

  const analytics = computeReportAnalytics(tasks, drivers);

  const generatedAt = new Date().toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  function drawPageHeader(subtitle: string) {
    doc.setFillColor(...COLOR_NAVY);
    doc.rect(0, 0, pageWidth, 64, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("CIKOPS FLEET OPERATIONS", marginX, 27);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(subtitle, marginX, 44);
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(
      `Periode ${formatDateOnly(dateFrom)} s/d ${formatDateOnly(dateTo)}`,
      pageWidth - marginX,
      27,
      { align: "right" }
    );
    doc.text(`Dibuat ${generatedAt}`, pageWidth - marginX, 40, {
      align: "right",
    });
  }

  function drawStatCard(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    accent: RGB
  ) {
    doc.setFillColor(...accent);
    doc.rect(x, y, w, 3, "F");
    doc.setDrawColor(...COLOR_LIGHT_BORDER);
    doc.setFillColor(...COLOR_LIGHT_BG);
    doc.rect(x, y + 3, w, h - 3, "FD");
    doc.setTextColor(...COLOR_NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(value, x + 12, y + h / 2 + 4);
    doc.setTextColor(...COLOR_GRAY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(label, x + 12, y + h - 8);
  }

  function drawSectionTitle(x: number, y: number, text: string) {
    doc.setFillColor(...COLOR_BRAND);
    doc.rect(x, y - 9, 3, 11, "F");
    doc.setTextColor(...COLOR_NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text(text, x + 9, y);
  }

  function drawBarChart(
    x: number,
    y: number,
    w: number,
    title: string,
    entries: RankedEntry[],
    color: RGB,
    valueFormatter: (v: number) => string = (v) => String(v)
  ): number {
    const rowHeight = 16;
    const labelWidth = w * 0.42;
    const barAreaX = x + labelWidth;
    const barAreaWidth = w - labelWidth - 46;
    const maxValue = Math.max(...entries.map((e) => e.value), 1);

    doc.setTextColor(...COLOR_NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(title, x, y);
    let rowY = y + 14;

    if (entries.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...COLOR_GRAY);
      doc.text("Tidak ada data", x, rowY + 4);
      return 14 + 18;
    }

    for (const entry of entries) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(40, 46, 70);
      const labelText = doc.splitTextToSize(entry.label, labelWidth - 6);
      doc.text(labelText[0] || entry.label, x, rowY + 5);

      const barW = Math.max(
        (entry.value / maxValue) * barAreaWidth,
        entry.value > 0 ? 4 : 0
      );
      doc.setFillColor(232, 236, 248);
      doc.roundedRect(barAreaX, rowY - 2, barAreaWidth, 8, 2, 2, "F");
      if (barW > 0) {
        doc.setFillColor(...color);
        doc.roundedRect(barAreaX, rowY - 2, barW, 8, 2, 2, "F");
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...COLOR_NAVY);
      doc.text(
        valueFormatter(entry.value),
        barAreaX + barAreaWidth + 6,
        rowY + 4
      );

      rowY += rowHeight;
    }

    return rowY - y;
  }

  function drawFooterNote() {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR_GRAY);
    doc.text(
      "CIKOPS Fleet OS — Laporan dibuat otomatis dari data sistem",
      marginX,
      pageHeight - 16
    );
  }

  /* ════════════════════════════════════════════════
     HALAMAN 1 — Ringkasan Keseluruhan + Analytics
  ════════════════════════════════════════════════ */
  drawPageHeader("Laporan Komprehensif Operasional Driver");

  let y = 96;
  drawSectionTitle(marginX, y, "Ringkasan Keseluruhan");
  y += 18;

  const summaryCards: Array<[string, string, RGB]> = [
    ["Total Tugas", String(analytics.totalTask), COLOR_BRAND],
    ["Baru Ditugaskan", String(analytics.assigned), COLOR_ORANGE],
    ["Sedang Berjalan", String(analytics.ongoing), COLOR_NEON],
    ["Selesai", String(analytics.done), COLOR_GREEN],
    ["Driver Aktif", String(analytics.driverAktif), COLOR_PURPLE],
    [
      "Tingkat Selesai",
      `${analytics.completionRate.toFixed(0)}%`,
      COLOR_GREEN,
    ],
  ];
  const cardGap = 8;
  const cardW =
    (contentWidth - cardGap * (summaryCards.length - 1)) / summaryCards.length;
  const cardH = 56;
  summaryCards.forEach(([label, value, color], i) => {
    drawStatCard(
      marginX + i * (cardW + cardGap),
      y,
      cardW,
      cardH,
      label,
      value,
      color
    );
  });
  y += cardH + 30;

  drawSectionTitle(marginX, y, "Analytics & Insights");
  y += 20;

  const colGap = 26;
  const colW = (contentWidth - colGap) / 2;
  const col1X = marginX;
  const col2X = marginX + colW + colGap;
  const rowTopY = y;

  const h1 = drawBarChart(
    col1X,
    rowTopY,
    colW,
    "Top Driver (Jumlah Tugas)",
    analytics.topDriverByTask,
    COLOR_BRAND
  );
  const h2 = drawBarChart(
    col2X,
    rowTopY,
    colW,
    "Rata-rata Durasi Pengerjaan per Driver",
    analytics.avgDurationByDriver,
    COLOR_NEON,
    (v) => formatMinutes(v)
  );

  const row2TopY = rowTopY + Math.max(h1, h2) + 26;
  const h3 = drawBarChart(
    col1X,
    row2TopY,
    colW,
    "Top Departemen Requestor",
    analytics.topDepartementRequestor,
    COLOR_PURPLE
  );
  const h4 = drawBarChart(
    col2X,
    row2TopY,
    colW,
    "Jenis Pekerjaan Terbanyak",
    analytics.topJenisPekerjaan,
    COLOR_GREEN
  );

  const row3TopY = row2TopY + Math.max(h3, h4) + 26;
  drawBarChart(
    col1X,
    row3TopY,
    colW,
    "Utilisasi Kendaraan",
    analytics.utilisasiKendaraan,
    COLOR_ORANGE
  );
  drawBarChart(
    col2X,
    row3TopY,
    colW,
    "Aktivitas Harian",
    analytics.aktivitasHarian.map((e) => ({
      ...e,
      label: formatDateOnly(e.label),
    })),
    COLOR_RED
  );

  drawFooterNote();

  /* ════════════════════════════════════════════════
     HALAMAN 2 — Ringkasan Performa per Driver
  ════════════════════════════════════════════════ */
  doc.addPage();
  drawPageHeader("Ringkasan Performa per Driver");
  y = 96;
  drawSectionTitle(marginX, y, "Ringkasan per Driver");

  const driverRows = analytics.driverSummaries.map((s) => [
    s.driverNama,
    String(s.totalTask),
    String(s.selesai),
    String(s.dibatalkan),
    String(s.aktif),
    `${s.completionRate.toFixed(0)}%`,
    formatMinutes(s.totalJamKerjaMinutes),
    s.avgDurationMinutes !== null ? formatMinutes(s.avgDurationMinutes) : "-",
  ]);

  autoTable(doc, {
    startY: y + 14,
    margin: { left: marginX, right: marginX },
    head: [
      [
        "Driver",
        "Total Tugas",
        "Selesai",
        "Dibatalkan",
        "Aktif",
        "Completion Rate",
        "Total Jam Kerja",
        "Avg Durasi/Tugas",
      ],
    ],
    body:
      driverRows.length > 0
        ? driverRows
        : [["Tidak ada data", "", "", "", "", "", "", ""]],
    theme: "grid",
    headStyles: {
      fillColor: COLOR_BRAND,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 8.5, textColor: [20, 26, 50] },
    alternateRowStyles: { fillColor: COLOR_LIGHT_BG },
  });

  drawFooterNote();

  /* ════════════════════════════════════════════════
     HALAMAN 3+ — Detail Lengkap Setiap Tugas
  ════════════════════════════════════════════════ */
  doc.addPage();
  drawPageHeader("Detail Lengkap Tugas");
  y = 96;
  drawSectionTitle(marginX, y, "Detail Lengkap Tugas");

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
    startY: y + 14,
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
      fillColor: COLOR_NAVY,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
    },
    bodyStyles: { fontSize: 7.5, textColor: [20, 26, 50] },
    alternateRowStyles: { fillColor: COLOR_LIGHT_BG },
    styles: { overflow: "linebreak" },
    columnStyles: {
      4: { cellWidth: 110 },
      5: { cellWidth: 90 },
    },
    didDrawPage: () => {
      drawFooterNote();
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR_GRAY);
    doc.text(
      `Halaman ${i} dari ${pageCount}`,
      pageWidth - marginX,
      pageHeight - 16,
      { align: "right" }
    );
  }

  doc.save(`CIKOPS_Report_${dateFrom}_to_${dateTo}.pdf`);
}
