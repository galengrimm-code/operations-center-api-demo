"use client";

const ICONS: Record<string, string> = {
  fertilizer: "💧",
  chemical: "🧪",
  seed: "🌱",
  adjuvant: "💦",
  other: "•",
};

const COLORS: Record<string, string> = {
  fertilizer: "bg-sky-500/10 text-sky-300",
  chemical: "bg-amber-500/10 text-amber-300",
  seed: "bg-emerald-500/10 text-emerald-300",
  adjuvant: "bg-cyan-500/10 text-cyan-300",
  other: "bg-slate-500/10 text-slate-300",
};

export function CategoryBadge({ category }: { category: string | null }) {
  const key = category ?? "other";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${COLORS[key] ?? COLORS.other}`}
    >
      <span>{ICONS[key] ?? ICONS.other}</span>
      <span className="capitalize">{category ?? "Uncategorized"}</span>
    </span>
  );
}
