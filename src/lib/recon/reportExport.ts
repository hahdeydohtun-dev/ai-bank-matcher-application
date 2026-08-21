import { CATEGORY_LABEL, type ReconciliationReport, type ReportCategory, type ReportItem } from "./report";
import { formatAmount, formatDate } from "./format";

export type ExportContext = {
  companyName: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  report: ReconciliationReport;
  items: ReportItem[];
};

const ORDER: ReportCategory[] = [
  "ledger_debits_not_in_bank",
  "ledger_credits_not_in_bank",
  "bank_credits_not_in_ledger",
  "bank_debits_not_in_ledger",
];

function fileBase(ctx: ExportContext) {
  return `${ctx.report.reconciliation_id}_v${ctx.report.version}`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportReportExcel(ctx: ExportContext) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Treasury Management System";
  const ws = wb.addWorksheet("Bank Reconciliation");
  const r = ctx.report;
  const money = '#,##0.00;(#,##0.00);"-"';

  ws.columns = [
    { width: 14 },
    { width: 46 },
    { width: 22 },
    { width: 18 },
    { width: 18 },
  ];

  const title = ws.addRow([`${ctx.companyName} — Bank Reconciliation Statement`]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(title.number, 1, title.number, 5);

  ws.addRow([`Bank`, `${ctx.bankName} — ${ctx.accountName || ctx.accountNumber}`]);
  ws.addRow([`Account No.`, ctx.accountNumber]);
  ws.addRow([`Reconciliation ID`, `${r.reconciliation_id} (v${r.version})`]);
  ws.addRow([`Period`, `${r.period_start ?? "start"} to ${r.period_end ?? r.as_of_date}`]);
  ws.addRow([`As-of date`, r.as_of_date]);
  ws.addRow([`Currency`, r.currency]);
  ws.addRow([`Prepared by`, r.prepared_by ?? ""]);
  ws.addRow([]);

  const startRow = ws.rowCount + 1;
  const header = ws.addRow(["Date", "Description", "Reference", "Amount", "Notes"]);
  header.font = { bold: true };
  header.eachCell((c) => {
    c.border = { bottom: { style: "thin" } };
  });

  const totalRefs: Partial<Record<ReportCategory, string>> = {};

  const balRow = ws.addRow(["", "Balance per bank statement", "", r.bank_statement_balance, ""]);
  balRow.getCell(2).font = { bold: true };
  balRow.getCell(4).numFmt = money;
  const bankBalanceRef = `D${balRow.number}`;

  for (const category of ORDER) {
    const rows = ctx.items.filter((i) => i.category === category && !i.excluded);
    const head = ws.addRow(["", CATEGORY_LABEL[category], "", "", ""]);
    head.getCell(2).font = { bold: true, italic: true };
    const first = ws.rowCount + 1;
    for (const item of rows) {
      const row = ws.addRow([
        item.item_date ?? "",
        item.description,
        item.reference,
        Number(item.amount),
        item.explanation ?? item.notes ?? "",
      ]);
      row.getCell(4).numFmt = money;
    }
    const last = ws.rowCount;
    const totalRow = ws.addRow([
      "",
      `Total — ${CATEGORY_LABEL[category]}`,
      "",
      rows.length ? { formula: `SUM(D${first}:D${last})` } : 0,
      "",
    ]);
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(4).numFmt = money;
    totalRow.getCell(4).border = { top: { style: "thin" } };
    totalRefs[category] = `D${totalRow.number}`;
  }

  ws.addRow([]);
  const adjBank = ws.addRow([
    "",
    "Adjusted bank balance",
    "",
    {
      formula: `${bankBalanceRef}+${totalRefs.ledger_debits_not_in_bank}-${totalRefs.ledger_credits_not_in_bank}`,
    },
    "",
  ]);
  adjBank.font = { bold: true };
  adjBank.getCell(4).numFmt = money;

  const glRow = ws.addRow(["", "Balance per general ledger", "", r.gl_balance, ""]);
  glRow.getCell(4).numFmt = money;

  const adjBook = ws.addRow([
    "",
    "Adjusted book balance",
    "",
    {
      formula: `D${glRow.number}+${totalRefs.bank_credits_not_in_ledger}-${totalRefs.bank_debits_not_in_ledger}`,
    },
    "",
  ]);
  adjBook.font = { bold: true };
  adjBook.getCell(4).numFmt = money;

  const diff = ws.addRow([
    "",
    "Unreconciled difference",
    "",
    { formula: `D${adjBank.number}-D${adjBook.number}` },
    "",
  ]);
  diff.font = { bold: true };
  diff.getCell(4).numFmt = money;
  diff.getCell(4).border = { top: { style: "thin" }, bottom: { style: "double" } };

  ws.addRow([]);
  ws.addRow(["", "Prepared by", r.prepared_by ?? "", "Date", r.prepared_at ?? ""]);
  ws.addRow(["", "Reviewed by", r.reviewed_by ?? "", "Date", r.reviewed_at ?? ""]);
  ws.addRow(["", "Approved by", r.approved_by ?? "", "Date", r.approved_at ?? ""]);

  ws.views = [{ state: "frozen", ySplit: startRow }];

  const buffer = await wb.xlsx.writeBuffer();
  download(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${fileBase(ctx)}.xlsx`,
  );
}

export async function exportReportPdf(ctx: ExportContext) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const r = ctx.report;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const currency = r.currency;

  doc.setFontSize(14);
  doc.text(`${ctx.companyName} — Bank Reconciliation Statement`, 40, 46);
  doc.setFontSize(9);
  doc.text(
    [
      `${ctx.bankName} · ${ctx.accountName || ctx.accountNumber} (${ctx.accountNumber})`,
      `${r.reconciliation_id} v${r.version} · As of ${formatDate(r.as_of_date)} · ${currency}`,
      `Period: ${r.period_start ?? "start"} → ${r.period_end ?? r.as_of_date}`,
    ],
    40,
    62,
  );

  const body: (string | number)[][] = [];
  body.push(["", "Balance per bank statement", "", formatAmount(r.bank_statement_balance, currency)]);
  for (const category of ORDER) {
    const rows = ctx.items.filter((i) => i.category === category && !i.excluded);
    body.push(["", CATEGORY_LABEL[category], "", ""]);
    for (const item of rows) {
      body.push([
        formatDate(item.item_date),
        item.description,
        item.reference,
        formatAmount(item.amount, currency),
      ]);
    }
    const sum = rows.reduce((s, i) => s + Number(i.amount), 0);
    body.push(["", `Total`, "", formatAmount(sum, currency)]);
  }
  body.push(["", "Adjusted bank balance", "", formatAmount(r.adjusted_bank_balance, currency)]);
  body.push(["", "Balance per general ledger", "", formatAmount(r.gl_balance, currency)]);
  body.push(["", "Adjusted book balance", "", formatAmount(r.adjusted_book_balance, currency)]);
  body.push([
    "",
    "Unreconciled difference",
    "",
    formatAmount(r.unreconciled_difference, currency),
  ]);

  autoTable(doc, {
    startY: 100,
    head: [["Date", "Description", "Reference", "Amount"]],
    body,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 3: { halign: "right" } },
  });

  const endY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 30;
  doc.text(
    [
      `Prepared by: ${r.prepared_by ?? "—"}`,
      `Reviewed by: ${r.reviewed_by ?? "—"}`,
      `Approved by: ${r.approved_by ?? "—"}`,
    ],
    40,
    endY,
  );

  doc.save(`${fileBase(ctx)}.pdf`);
}

export function exportReportCsv(ctx: ExportContext) {
  const lines = [["Category", "Date", "Description", "Reference", "Amount", "Explanation"]];
  for (const category of ORDER) {
    for (const item of ctx.items.filter((i) => i.category === category && !i.excluded)) {
      lines.push([
        CATEGORY_LABEL[category],
        item.item_date ?? "",
        item.description,
        item.reference,
        String(item.amount),
        item.explanation ?? "",
      ]);
    }
  }
  const csv = lines
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${fileBase(ctx)}.csv`);
}
