"use client";

const ICONS: Record<string, string> = {
  fertilizer: "💧",
  chemical: "🧪",
  seed: "🌱",
  adjuvant: "💦",
  other: "•",
};

const COLORS: Record<string, string> = {
  fertilizer: "bg-blue-50 text-blue-700",
  chemical: "bg-amber-50 text-amber-700",
  seed: "bg-emerald-50 text-emerald-700",
  adjuvant: "bg-cyan-50 text-cyan-700",
  other: "bg-slate-50 text-slate-700",
};

export function CategoryBadge({ category }: { category: string | null }) {
  const key = category ?? "other";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${COLORS[key] ?? COLORS.other}`}
    >
      <span>{ICONS[key] ?? ICONS.other}</span>
      <span className="capitalize">{category ?? "Uncategorized"}</span>
    </span>
  );
}
