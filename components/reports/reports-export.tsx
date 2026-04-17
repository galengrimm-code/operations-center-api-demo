'use client';

import { Button } from '@/components/ui/button';
import { Download, Printer } from 'lucide-react';
import { type ReportRow } from '@/lib/reports-data';
import { generateCSV, downloadCSV, generatePDFHtml, printPDF } from '@/lib/reports-export-utils';

interface ReportsExportProps {
  rows: ReportRow[];
  season: string;
}

export function ReportsExport({ rows, season }: ReportsExportProps) {
  const handleCSV = () => {
    const csv = generateCSV(rows, season);
    downloadCSV(csv, `harvest-data-report-${season}.csv`);
  };

  const handlePDF = () => {
    const html = generatePDFHtml(rows, season, 'Harvest Data Report');
    printPDF(html);
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleCSV} className="border-slate-700 text-slate-300 hover:text-white">
        <Download className="w-4 h-4 mr-1" /> CSV
      </Button>
      <Button variant="outline" size="sm" onClick={handlePDF} className="border-slate-700 text-slate-300 hover:text-white">
        <Printer className="w-4 h-4 mr-1" /> PDF
      </Button>
    </div>
  );
}
