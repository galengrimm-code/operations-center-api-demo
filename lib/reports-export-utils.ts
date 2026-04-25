import { type ReportRow, formatCropName, toDryYield } from './reports-data';

function fmt(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '';
  return value.toFixed(decimals);
}

export function generateCSV(rows: ReportRow[], season: string): string {
  const headers = [
    'Field', 'Crop', 'Season',
    'Irrigated Acres', 'Dryland Acres', 'Total Acres',
    'Irrigated Yield (bu/ac)', 'Dryland Yield (bu/ac)',
    'Total Bu/Ac', 'Moisture %',
  ];

  const csvRows = [headers.join(',')];

  for (const row of rows) {
    const cropName = row.operation.crop_name;
    const irrYieldDry = row.analysis
      ? toDryYield(row.analysis.irrigated_yield, row.analysis.irrigated_moisture, cropName)
      : null;
    const dryYieldDry = row.analysis
      ? toDryYield(row.analysis.dryland_yield, row.analysis.dryland_moisture, cropName)
      : null;
    const totalBuAc = toDryYield(row.operation.avg_yield_value, row.operation.avg_moisture, cropName);
    csvRows.push([
      `"${row.field.name}"`,
      formatCropName(cropName),
      row.operation.crop_season || season,
      fmt(row.irrigatedAcres),
      fmt(row.drylandAcres),
      fmt(row.totalAcres),
      fmt(irrYieldDry),
      fmt(dryYieldDry),
      fmt(totalBuAc),
      fmt(row.operation.avg_moisture),
    ].join(','));
  }

  return csvRows.join('\n');
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function generatePDFHtml(rows: ReportRow[], season: string, title: string): string {
  const tableRows = rows.map((row) => {
    const cropName = row.operation.crop_name;
    const irrYieldDry = row.analysis
      ? toDryYield(row.analysis.irrigated_yield, row.analysis.irrigated_moisture, cropName)
      : null;
    const dryYieldDry = row.analysis
      ? toDryYield(row.analysis.dryland_yield, row.analysis.dryland_moisture, cropName)
      : null;
    const totalBuAc = toDryYield(row.operation.avg_yield_value, row.operation.avg_moisture, cropName);
    return `
    <tr>
      <td>${row.field.name}</td>
      <td>${formatCropName(cropName)}</td>
      <td style="text-align:right">${fmt(row.irrigatedAcres)}</td>
      <td style="text-align:right">${fmt(row.drylandAcres)}</td>
      <td style="text-align:right">${fmt(row.totalAcres)}</td>
      <td style="text-align:right">${row.analysis ? fmt(irrYieldDry) : '--'}</td>
      <td style="text-align:right">${row.analysis ? fmt(dryYieldDry) : '--'}</td>
      <td style="text-align:right;font-weight:bold">${fmt(totalBuAc)}</td>
      <td style="text-align:right">${row.operation.avg_moisture != null ? fmt(row.operation.avg_moisture, 1) + '%' : '--'}</td>
    </tr>
  `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    h2 { font-size: 13px; color: #666; margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; }
    th { background: #f5f5f5; text-align: left; font-size: 10px; text-transform: uppercase; }
    td { font-size: 11px; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <h2>Season: ${season}</h2>
  <table>
    <thead>
      <tr>
        <th>Field</th><th>Crop</th>
        <th style="text-align:right">Irr Ac</th><th style="text-align:right">Dry Ac</th><th style="text-align:right">Total Ac</th>
        <th style="text-align:right">Irr Yield</th><th style="text-align:right">Dry Yield</th>
        <th style="text-align:right">Total Bu/Ac</th>
        <th style="text-align:right">Mst %</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;
}

export function printPDF(html: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.print(); };
}
