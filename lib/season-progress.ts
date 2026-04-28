import { supabase } from '@/lib/supabase';
import { convertArea } from '@/lib/area-utils';
import type { StoredField, StoredFieldOperation, FieldSeason } from '@/types/john-deere';

export interface FieldProgressRow {
  field_id: string;
  field_name: string;
  jd_field_id: string;
  farm_name: string | null;
  crop: string | null;
  target_acres: number;
  planted_acres: number;
  planted_date: string | null;
  source: 'manual' | 'jd' | 'none';
}

export interface CropProgress {
  crop: string;
  target_acres: number;
  planted_acres: number;
  fields_total: number;
  fields_planted: number;
}

// monthDay = "MM-DD" so all years share the same x-axis. Recharts plots each
// `${crop}__${year}` series as its own line; the page styles current-year
// crops as filled areas and prior-year crops as faded reference lines.
export interface CumulativePoint {
  monthDay: string;
  [seriesKey: string]: number | string;
}

export interface SeasonProgress {
  year: number;
  yearsIncluded: number[]; // [currentYear, currentYear-1, currentYear-2, ...]
  crops: CropProgress[];
  fields: FieldProgressRow[];
  cumulative: CumulativePoint[];
  unit: 'ac';
}

const fieldAcres = (f: Pick<StoredField, 'boundary_area_value' | 'boundary_area_unit'>): number => {
  if (f.boundary_area_value == null || !f.boundary_area_unit) return 0;
  return convertArea(f.boundary_area_value, f.boundary_area_unit, 'ac');
};

const opAcres = (op: Pick<StoredFieldOperation, 'area_value' | 'area_unit'>): number => {
  if (op.area_value == null || !op.area_unit) return 0;
  return convertArea(op.area_value, op.area_unit, 'ac');
};

const normalizeCrop = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const c = raw.trim().toUpperCase();
  if (!c || c === '---') return null;
  if (c.startsWith('SOYBEAN')) return 'SOYBEANS';
  if (c.startsWith('CORN')) return 'CORN';
  if (c.startsWith('WHEAT')) return 'WHEAT';
  return c;
};

const dateKey = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const monthDayKey = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(5, 10); // "MM-DD"
};

export const seriesKey = (crop: string, year: number): string => `${crop}__${year}`;

export async function loadSeasonProgress(opts: {
  userId: string;
  orgId: string;
  year: number;
  hiddenCrops?: string[];
  farmFilter?: string | null;
  priorYears?: number;
}): Promise<SeasonProgress> {
  const { userId, orgId, year, hiddenCrops = [], farmFilter = null, priorYears = 2 } = opts;
  const hidden = new Set(hiddenCrops.map((c) => c.toUpperCase()));

  const yearsIncluded: number[] = [];
  for (let i = 0; i <= priorYears; i++) yearsIncluded.push(year - i);
  const yearStrings = yearsIncluded.map(String);

  const [fieldsRes, opsRes, seasonsRes] = await Promise.all([
    supabase
      .from('fields')
      .select('id,jd_field_id,name,farm_name,boundary_area_value,boundary_area_unit')
      .eq('user_id', userId)
      .eq('org_id', orgId),
    supabase
      .from('field_operations')
      .select('jd_field_id,crop_season,crop_name,crop_name_override,start_date,area_value,area_unit')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .eq('operation_type', 'seeding')
      .in('crop_season', yearStrings),
    supabase
      .from('field_seasons')
      .select('*')
      .eq('user_id', userId)
      .eq('season_year', year),
  ]);

  if (fieldsRes.error) throw fieldsRes.error;
  if (opsRes.error) throw opsRes.error;
  if (seasonsRes.error) throw seasonsRes.error;

  const allFields = (fieldsRes.data || []) as Array<
    Pick<StoredField, 'id' | 'jd_field_id' | 'name' | 'farm_name' | 'boundary_area_value' | 'boundary_area_unit'>
  >;

  // Apply farm filter at the field level
  const fields = farmFilter ? allFields.filter((f) => f.farm_name === farmFilter) : allFields;
  const allowedJdFieldIds = new Set(fields.map((f) => f.jd_field_id));

  const allOps = (opsRes.data || []) as Array<
    Pick<
      StoredFieldOperation,
      'jd_field_id' | 'crop_season' | 'crop_name' | 'crop_name_override' | 'start_date' | 'area_value' | 'area_unit'
    >
  >;
  // Filter ops to fields in the active farm filter
  const ops = farmFilter ? allOps.filter((op) => allowedJdFieldIds.has(op.jd_field_id)) : allOps;

  const seasons = (seasonsRes.data || []) as FieldSeason[];
  const seasonByField = new Map<string, FieldSeason>();
  seasons.forEach((s) => seasonByField.set(s.field_id, s));

  // For the current-year fields table: keep largest seeding op per field (current year only).
  const currentYearOps = ops.filter((op) => op.crop_season === String(year));
  const opByField = new Map<string, typeof ops[number]>();
  currentYearOps.forEach((op) => {
    const existing = opByField.get(op.jd_field_id);
    if (!existing || opAcres(op) > opAcres(existing)) {
      opByField.set(op.jd_field_id, op);
    }
  });

  const rows: FieldProgressRow[] = fields.map((f) => {
    const season = seasonByField.get(f.id);
    const op = opByField.get(f.jd_field_id);

    const cropFromSeason = normalizeCrop(season?.intended_crop);
    const cropFromOp = normalizeCrop(op?.crop_name_override || op?.crop_name);
    const crop = cropFromSeason || cropFromOp;

    const target =
      season?.intended_acres != null && season.intended_acres > 0
        ? season.intended_acres
        : fieldAcres(f);

    let planted = 0;
    let planted_date: string | null = null;
    let source: FieldProgressRow['source'] = 'none';

    if (season?.planted_acres != null || season?.planted_date) {
      planted = season.planted_acres ?? (op ? opAcres(op) : 0);
      planted_date = season.planted_date ?? (op ? dateKey(op.start_date) : null);
      source = 'manual';
    } else if (op) {
      planted = opAcres(op);
      planted_date = dateKey(op.start_date);
      source = 'jd';
    }

    return {
      field_id: f.id,
      field_name: f.name,
      jd_field_id: f.jd_field_id,
      farm_name: f.farm_name,
      crop,
      target_acres: target,
      planted_acres: planted,
      planted_date,
      source,
    };
  });

  // Aggregate by crop (current year only)
  const cropMap = new Map<string, CropProgress>();
  rows.forEach((r) => {
    if (!r.crop) return;
    if (hidden.has(r.crop)) return;
    let entry = cropMap.get(r.crop);
    if (!entry) {
      entry = { crop: r.crop, target_acres: 0, planted_acres: 0, fields_total: 0, fields_planted: 0 };
      cropMap.set(r.crop, entry);
    }
    entry.target_acres += r.target_acres;
    entry.planted_acres += r.planted_acres;
    entry.fields_total += 1;
    if (r.planted_acres > 0) entry.fields_planted += 1;
  });

  const crops = Array.from(cropMap.values()).sort((a, b) => b.target_acres - a.target_acres);
  const currentYearCrops = crops.map((c) => c.crop);

  // Build cumulative-by-monthDay per (crop, year). Prior years use raw operations
  // (we don't have field_seasons for them, and the goal is "what was the pace").
  // We only chart currentYearCrops — keeps the chart focused on what's relevant
  // and avoids cluttering with crops that aren't in this year's plan.

  // Map<year, Map<crop, Map<monthDay, acresAddedThatDay>>>
  const yearCropDay = new Map<number, Map<string, Map<string, number>>>();
  yearsIncluded.forEach((y) => {
    const cropMap = new Map<string, Map<string, number>>();
    currentYearCrops.forEach((c) => cropMap.set(c, new Map()));
    yearCropDay.set(y, cropMap);
  });

  const addToBucket = (y: number, crop: string, md: string, acres: number) => {
    const yMap = yearCropDay.get(y);
    if (!yMap) return;
    const cMap = yMap.get(crop);
    if (!cMap) return;
    cMap.set(md, (cMap.get(md) ?? 0) + acres);
  };

  // Current year: prefer manual override (from rows[]) so manual edits show up
  // in the chart immediately. Fall back to all current-year ops for fields with
  // no manual override.
  rows.forEach((r) => {
    if (!r.crop || !currentYearCrops.includes(r.crop)) return;
    if (hidden.has(r.crop)) return;
    if (r.source !== 'manual') return; // JD-derived rows handled in op loop below
    if (!r.planted_date || r.planted_acres <= 0) return;
    const md = monthDayKey(r.planted_date);
    if (!md) return;
    addToBucket(year, r.crop, md, r.planted_acres);
  });

  // For non-manual current-year fields: use ops directly
  const manualFieldIds = new Set(rows.filter((r) => r.source === 'manual').map((r) => r.jd_field_id));

  ops.forEach((op) => {
    const opYear = op.crop_season ? Number(op.crop_season) : NaN;
    if (!yearsIncluded.includes(opYear)) return;

    const crop = normalizeCrop(op.crop_name_override || op.crop_name);
    if (!crop || !currentYearCrops.includes(crop)) return;
    if (hidden.has(crop)) return;

    // Skip current-year ops for fields where the user supplied a manual override —
    // those were counted via the rows loop above.
    if (opYear === year && manualFieldIds.has(op.jd_field_id)) return;

    const md = monthDayKey(op.start_date);
    if (!md) return;

    addToBucket(opYear, crop, md, opAcres(op));
  });

  // Collect all monthDays across all years/crops, then build cumulative series.
  const allMonthDays = new Set<string>();
  yearCropDay.forEach((cropMap) => {
    cropMap.forEach((dayMap) => {
      dayMap.forEach((_, md) => allMonthDays.add(md));
    });
  });
  const sortedMonthDays = Array.from(allMonthDays).sort();

  // Running totals per (year, crop)
  const running = new Map<string, number>();
  yearsIncluded.forEach((y) => {
    currentYearCrops.forEach((c) => running.set(seriesKey(c, y), 0));
  });

  const cumulative: CumulativePoint[] = sortedMonthDays.map((md) => {
    const point: CumulativePoint = { monthDay: md };
    yearsIncluded.forEach((y) => {
      const yMap = yearCropDay.get(y);
      if (!yMap) return;
      currentYearCrops.forEach((c) => {
        const cMap = yMap.get(c);
        const added = cMap?.get(md) ?? 0;
        const key = seriesKey(c, y);
        const next = (running.get(key) ?? 0) + added;
        running.set(key, next);
        point[key] = Math.round(next * 10) / 10;
      });
    });
    return point;
  });

  return {
    year,
    yearsIncluded,
    crops,
    fields: rows,
    cumulative,
    unit: 'ac',
  };
}
