// Client-side Products-rollup export to Excel (.xlsx, category-colored cells) and PDF.
// Heavy libs (exceljs, jspdf) are dynamic-imported so they stay out of the main bundle.
import { appliedInPriceUnit } from "./cost-calc";
import { displayUnit } from "./unit-display";
import type { Product } from "@/types/applications";

export interface ExportRow {
  product: Product;
  total_value_sum: number;
  total_unit: string | null;
  field_count: number;
  operation_count: number;
}
export type PriceMap = Map<string, { price_per_unit: number; price_unit: string }>;
export type AvgMap = Map<string, { avg: number; unit: string }>;

// Category fills, matching the in-app CategoryBadge palette (light tints, dark text).
const CAT_HEX: Record<string, string> = {
  fertilizer: "E0F2FE", // sky-100
  chemical: "FEF3C7", // amber-100
  seed: "D1FAE5", // emerald-100
  adjuvant: "CFFAFE", // cyan-100
  other: "F1F5F9", // slate-100
};
const CAT_RGB: Record<string, [number, number, number]> = {
  fertilizer: [224, 242, 254],
  chemical: [254, 243, 199],
  seed: [209, 250, 229],
  adjuvant: [207, 250, 254],
  other: [241, 245, 249],
};

function unitLabel(u: string | null): string {
  return u === "ozm" ? "oz" : displayUnit(u);
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface RowCells {
  category: string;
  name: string;
  categoryLabel: string;
  price: string;
  applied: string;
  totalCost: string;
  fields: number;
  ops: number;
}

function buildRow(
  r: ExportRow,
  prices: PriceMap,
  allSeasons: boolean,
  avgs?: AvgMap,
): RowCells {
  const category = r.product.product_category ?? "other";
  const priceEntry = prices.get(r.product.id);
  const avgEntry = avgs?.get(r.product.id);
  const priceUnit = allSeasons ? (avgEntry?.unit ?? null) : (priceEntry?.price_unit ?? null);
  const pricePerUnit = allSeasons ? (avgEntry?.avg ?? null) : (priceEntry?.price_per_unit ?? null);

  const applied = priceUnit
    ? appliedInPriceUnit(r.total_value_sum, r.total_unit, {
        price_per_unit: 0,
        price_unit: priceUnit,
        density_lbs_per_gal: r.product.density_lbs_per_gal,
        nutrient_content_pct: r.product.nutrient_content_pct,
      })
    : null;
  const appliedStr =
    applied != null
      ? `${applied.toFixed(2)} ${unitLabel(priceUnit)}`
      : `${r.total_value_sum.toFixed(2)} ${unitLabel(r.total_unit)}`;
  const totalCost = applied != null && pricePerUnit != null ? applied * pricePerUnit : null;

  return {
    category,
    name: r.product.name,
    categoryLabel: category === "other" && !r.product.product_category ? "Uncategorized" : cap(category),
    price: pricePerUnit != null ? `$${pricePerUnit.toFixed(2)}/${unitLabel(priceUnit)}` : "—",
    applied: appliedStr,
    totalCost: totalCost != null ? `$${totalCost.toFixed(2)}` : "—",
    fields: r.field_count,
    ops: r.operation_count,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportProductsExcel(
  rows: ExportRow[],
  prices: PriceMap,
  allSeasons: boolean,
  avgs?: AvgMap,
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Products");
  ws.columns = [
    { header: "Product", key: "name", width: 34 },
    { header: "Category", key: "categoryLabel", width: 14 },
    { header: "Price", key: "price", width: 16 },
    { header: "Total Applied", key: "applied", width: 18 },
    { header: "Total Cost", key: "totalCost", width: 14 },
    { header: "Fields", key: "fields", width: 8 },
    { header: "Operations", key: "ops", width: 11 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  ws.getRow(1).font = { bold: true, color: { argb: "FFF1F5F9" } };

  for (const r of rows) {
    const d = buildRow(r, prices, allSeasons, avgs);
    const row = ws.addRow(d);
    const hex = CAT_HEX[d.category] ?? CAT_HEX.other;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex}` } };
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "farm-data-hub-products.xlsx",
  );
}

export async function exportProductsPdf(
  rows: ExportRow[],
  prices: PriceMap,
  allSeasons: boolean,
  avgs?: AvgMap,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF();
  const cells = rows.map((r) => buildRow(r, prices, allSeasons, avgs));
  doc.setFontSize(14);
  doc.text("Farm Data Hub — Products", 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [["Product", "Category", "Price", "Total Applied", "Total Cost", "Fields", "Ops"]],
    body: cells.map((d) => [d.name, d.categoryLabel, d.price, d.applied, d.totalCost, d.fields, d.ops]),
    headStyles: { fillColor: [30, 41, 59], textColor: [241, 245, 249] },
    didParseCell: (data) => {
      if (data.section === "body") {
        const cat = cells[data.row.index].category;
        data.cell.styles.fillColor = CAT_RGB[cat] ?? CAT_RGB.other;
      }
    },
  });
  doc.save("farm-data-hub-products.pdf");
}
