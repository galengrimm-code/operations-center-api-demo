"use client";

import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle } from "lucide-react";

interface AnalysisRunnerProps {
  unanalyzedCount: number;
  isBatchRunning: boolean;
  batchProgress: { current: number; total: number; fieldName: string } | null;
  onRunAll: () => void;
}

export function AnalysisRunner({
  unanalyzedCount,
  isBatchRunning,
  batchProgress,
  onRunAll,
}: AnalysisRunnerProps) {
  if (unanalyzedCount === 0 && !isBatchRunning) return null;

  return (
    <div className="flex items-center gap-4">
      {isBatchRunning && batchProgress ? (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            Analyzing {batchProgress.fieldName}... {batchProgress.current} of {batchProgress.total}
          </span>
        </div>
      ) : unanalyzedCount > 0 ? (
        <Button onClick={onRunAll} className="bg-emerald-600 text-white hover:bg-emerald-700">
          <PlayCircle className="mr-2 h-4 w-4" />
          Run All Analysis ({unanalyzedCount})
        </Button>
      ) : null}
    </div>
  );
}
