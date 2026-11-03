"use client";
// PDF / Excel exports for Hisaab-Kitab reports (browser only).
import { downloadXlsx } from "./excel";
import type { Summary } from "./finance";

type Cell = string | number | null | undefined;

export interface ReportSpec {
  title: string;
  subtitle?: string;
  filename: string; // without extension
  summary?: [string, string][];
  columns: string[];
  rows: Cell[][];
  /** Column indexes that hold money values (right-aligned). */
  moneyCols?: number[];
}

/** Money for PDFs: the built-in PDF fonts have no ₹ glyph. */
export function pdfMoney(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  return `${v < 0 ? "-" : ""}Rs. ${s}`;
}

// jsPDF's standard fonts only cover Latin-1. Cells with other scripts (e.g. Hindi
// names) are drawn as small canvas images using the page's web fonts instead.
const NON_LATIN = /[^\u0000-ÿ]/;

function textImage(text: string, pxHeight: number): { url: string; ratio: number } | null {
  try {
    const scale = 4;
    const font = `${pxHeight * scale}px "Noto Sans Devanagari", "Inter", sans-serif`;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 4;
    const h = Math.ceil(pxHeight * scale * 1.5);
    c.width = w;
    c.height = h;
    ctx.font = font;
    ctx.fillStyle = "#1f2a26";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 2, h / 2);
    return { url: c.toDataURL("image/png"), ratio: w / h };
  } catch {
    return null;
  }
}

export async function exportPdf(spec: ReportSpec): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: spec.columns.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(24, 61, 50);
  doc.rect(0, 0, pageW, 64, "F");
  doc.setTextColor(230, 184, 92);
  doc.setFontSize(15);
  doc.text("Pahil Vatika Yoga Group, Khajuraho", 40, 28);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text(`Hisaab-Kitab · ${spec.title}`, 40, 47);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`, pageW - 40, 47, { align: "right" });

  let y = 88;
  doc.setTextColor(31, 42, 38);
  if (spec.subtitle) {
    doc.setFontSize(10);
    doc.text(spec.subtitle, 40, y);
    y += 16;
  }
  if (spec.summary?.length) {
    autoTable(doc, {
      startY: y,
      body: spec.summary,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 160 }, 1: { halign: "right", cellWidth: 140 } },
      margin: { left: 40 },
      tableWidth: 300,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  }

  const images = new Map<string, { url: string; ratio: number } | null>();
  const money = new Set(spec.moneyCols ?? []);
  autoTable(doc, {
    startY: y,
    head: [spec.columns],
    body: spec.rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))),
    styles: { fontSize: 8.5, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [76, 149, 108], textColor: 255 },
    alternateRowStyles: { fillColor: [247, 244, 234] },
    columnStyles: Object.fromEntries([...money].map((i) => [i, { halign: "right" as const }])),
    margin: { left: 40, right: 40 },
    didParseCell: (data) => {
      const raw = data.cell.raw;
      if (data.section === "body" && typeof raw === "string" && NON_LATIN.test(raw)) {
        if (!images.has(raw)) images.set(raw, textImage(raw, 9));
        (data.cell as unknown as { _img?: string })._img = raw;
        data.cell.text = [""];
      }
    },
    didDrawCell: (data) => {
      const key = (data.cell as unknown as { _img?: string })._img;
      if (!key) return;
      const img = images.get(key);
      if (!img) return;
      const h = Math.min(12, data.cell.height - 4);
      const w = Math.min(h * img.ratio, data.cell.width - 6);
      doc.addImage(img.url, "PNG", data.cell.x + 4, data.cell.y + (data.cell.height - h) / 2, w, w / img.ratio);
    },
    didDrawPage: () => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(115, 123, 118);
      doc.text(`Page ${doc.getNumberOfPages()}`, pageW - 40, pageH - 20, { align: "right" });
      doc.text("Computed from the audited transaction ledger.", 40, pageH - 20);
    },
  });

  if (!spec.rows.length) {
    doc.setFontSize(10);
    doc.text("No records for this report.", 40, (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20);
  }
  doc.save(`${spec.filename}.pdf`);
}

export function exportXlsx(spec: ReportSpec): void {
  const rows = spec.rows.map((r) => Object.fromEntries(spec.columns.map((c, i) => [c, r[i] ?? ""])));
  const sheets = [{ name: spec.title, rows }];
  if (spec.summary?.length) sheets.push({ name: "Summary", rows: spec.summary.map(([k, v]) => ({ Item: k, Value: v })) });
  downloadXlsx(`${spec.filename}.xlsx`, sheets);
}

export function summaryPairs(s: Summary): [string, string][] {
  return [
    ["Total collection", pdfMoney(s.collection)],
    ["Total expenditure", pdfMoney(s.expenditure)],
    ["Opening balance", pdfMoney(s.openingBalance)],
    ["Available balance", pdfMoney(s.balance)],
  ];
}
