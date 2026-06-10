import { callJohnDeereApi } from "../../_shared/john-deere.ts";
import { JdBoundary } from "../../_shared/boundaries.ts";

// --- Diagnostic: show ALL boundaries (active + irrigated + others) for a field ---
// so we can see what JD has for fields with bogus irrigated splits.

export async function debugFieldBoundaries(accessToken: string, orgId: string, fieldId: string) {
  const response = await callJohnDeereApi(
    accessToken,
    `/organizations/${orgId}/fields/${fieldId}/boundaries?recordFilter=all`,
  );
  if (!response.ok) {
    return { ok: false as const, status: response.status };
  }
  const data = await response.json();
  const boundaries: JdBoundary[] = data.values || [];

  const summary = boundaries.map((b) => {
    let polyCount = 0;
    let totalRings = 0;
    let totalPoints = 0;
    for (const p of b.multipolygons || []) {
      polyCount++;
      for (const r of p.rings || []) {
        totalRings++;
        totalPoints += (r.points || []).length;
      }
    }
    return {
      id: b.id,
      name: b.name || null,
      active: b.active,
      irrigated: b.irrigated ?? null,
      area_value: b.area?.valueAsDouble ?? null,
      area_unit: b.area?.unit ?? null,
      workable_value: b.workableArea?.valueAsDouble ?? null,
      polygon_count: polyCount,
      ring_count: totalRings,
      point_count: totalPoints,
    };
  });

  return {
    ok: true as const,
    fieldId,
    count: boundaries.length,
    boundaries: summary,
  };
}
