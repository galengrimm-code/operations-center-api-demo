"use client";

export function InconsistencyBadge({
  rate,
  area,
  total,
}: {
  rate: number | null;
  area: number | null;
  total: number | null;
}) {
  if (rate == null || area == null || total == null) return null;
  const expected = rate * area;
  const eps = Math.max(0.5, expected * 0.05); // 5% tolerance or 0.5 absolute
  if (Math.abs(total - expected) <= eps) return null;
  return (
    <span
      className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
      title={`Rate × area = ${expected.toFixed(2)}, but total is ${total}. Save still works.`}
    >
      ⚠ inconsistent
    </span>
  );
}
