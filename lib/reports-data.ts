import { supabase } from './supabase';
import { convertArea } from './area-utils';
import turfArea from '@turf/area';
import turfIntersect from '@turf/intersect';
import type { StoredField, StoredFieldOperation, IrrigationAnalysisResult } from '@/types/john-deere';

export interface ReportRow {
  field: StoredField;
  operation: StoredFieldOperation;
  analysis: IrrigationAnalysisResult | null;
  irrigatedAcres: number;
  drylandAcres: number;
  totalAcres: number;
}

/** Display-friendly crop names */
const CROP_DISPLAY_NAMES: Record<string, string> = {
  CORN_WET: 'Corn',
  CORN_EURO: 'Amylose',
  SOYBEANS: 'Soybeans',
};

export function formatCropName(raw: string | null): string {
  if (!raw) return 'Unknown';
  return CROP_DISPLAY_NAMES[raw] || raw;
}

/** Standard moisture for dry yield conversion */
const STANDARD_MOISTURE: Record<string, number> = {
  CORN_WET: 0.155,    // 15.5% for corn
  CORN_EURO: 0.155,   // 15.5% for amylose corn
};

/**
 * Convert wet yield to dry yield at standard moisture.
 * Soybeans are already dry yield — no conversion needed.
 * Formula: dry = wet * (1 - actual_moisture/100) / (1 - standard_moisture)
 */
export function toDryYield(
  wetYield: number | null,
  moisture: number | null,
  cropName: string | null,
): number | null {
  if (wetYield == null) return null;
  const standard = STANDARD_MOISTURE[cropName || ''];
  if (!standard) return wetYield; // No conversion (soybeans, etc.)
  if (moisture == null) return wetYield; // Can't convert without moisture
  return wetYield * (1 - moisture / 100) / (1 - standard);
}

/** Fetch all fields that have irrigated boundaries */
export async function fetchIrrigatedFields(userId: string, orgId: string): Promise<StoredField[]> {
  const { data, error } = await (supabase
    .from('fields') as any)
    .select('*')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('has_irrigated_boundary', true);

  if (error) throw new Error(`Failed to load fields: ${(error as any).message}`);
  return (data as StoredField[]) || [];
}

/** Fetch harvest operations for a set of fields, optionally filtered by season and crop */
export async function fetchHarvestOperations(
  userId: string,
  orgId: string,
  fieldIds: string[],
  season?: string,
  cropName?: string,
): Promise<StoredFieldOperation[]> {
  let query = (supabase
    .from('field_operations') as any)
    .select('*')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('operation_type', 'harvest')
    .in('jd_field_id', fieldIds);

  if (season) query = query.eq('crop_season', season);
  if (cropName) query = query.eq('crop_name', cropName);

  const { data, error } = await query.order('crop_season', { ascending: false });
  if (error) throw new Error(`Failed to load operations: ${(error as any).message}`);
  return (data as StoredFieldOperation[]) || [];
}

/** Fetch all available crop seasons */
export async function fetchAvailableSeasons(userId: string, orgId: string): Promise<string[]> {
  const { data, error } = await (supabase
    .from('field_operations') as any)
    .select('crop_season')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('operation_type', 'harvest')
    .not('crop_season', 'is', null);

  if (error) return [];
  const rows = (data || []) as Array<{ crop_season: string }>;
  const seasons = Array.from(new Set(rows.map(d => d.crop_season)));
  return seasons.sort((a, b) => b.localeCompare(a));
}

/** Fetch all available crop names for irrigated fields */
export async function fetchAvailableCrops(
  userId: string,
  orgId: string,
  fieldIds: string[],
): Promise<string[]> {
  const { data, error } = await (supabase
    .from('field_operations') as any)
    .select('crop_name')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('operation_type', 'harvest')
    .in('jd_field_id', fieldIds)
    .not('crop_name', 'is', null);

  if (error) return [];
  const rows = (data || []) as Array<{ crop_name: string }>;
  const crops = Array.from(new Set(rows.map(d => d.crop_name)));
  return crops.sort();
}

/** Fetch cached analysis results for a list of operation IDs */
export async function fetchAnalysisResults(
  userId: string,
  operationIds: string[],
): Promise<IrrigationAnalysisResult[]> {
  if (operationIds.length === 0) return [];
  const { data, error } = await (supabase
    .from('irrigation_analysis_results') as any)
    .select('*')
    .eq('user_id', userId)
    .in('jd_operation_id', operationIds);

  if (error) throw new Error(`Failed to load analysis results: ${(error as any).message}`);
  return (data as IrrigationAnalysisResult[]) || [];
}

/** Save an analysis result (upsert by user_id + jd_operation_id) */
export async function saveAnalysisResult(
  result: Omit<IrrigationAnalysisResult, 'id' | 'created_at'>,
): Promise<void> {
  const { error } = await (supabase
    .from('irrigation_analysis_results') as any)
    .upsert(result, { onConflict: 'user_id,jd_operation_id' });

  if (error) throw new Error(`Failed to save analysis: ${(error as any).message}`);
}

/** Delete an analysis result and its cached shapefile */
export async function deleteAnalysisResult(
  userId: string,
  operationId: string,
): Promise<void> {
  await (supabase
    .from('irrigation_analysis_results') as any)
    .delete()
    .eq('user_id', userId)
    .eq('jd_operation_id', operationId);

  await supabase.storage
    .from('shapefiles')
    .remove([`${userId}/${operationId}.zip`]);
}

/** Build report rows by joining fields, operations, and cached analysis */
export function buildReportRows(
  fields: StoredField[],
  operations: StoredFieldOperation[],
  analysisResults: IrrigationAnalysisResult[],
): ReportRow[] {
  const fieldMap = new Map(fields.map(f => [f.jd_field_id, f]));
  const analysisMap = new Map(analysisResults.map(a => [a.jd_operation_id, a]));

  return operations
    .filter(op => fieldMap.has(op.jd_field_id))
    .map(op => {
      const field = fieldMap.get(op.jd_field_id)!;
      const analysis = analysisMap.get(op.jd_operation_id) || null;

      // Compute acreage from actual GeoJSON boundaries using turf
      const SQM_TO_AC = 0.000247105;
      let totalAcres = 0;
      let irrigatedAcres = 0;

      if (field.boundary_geojson) {
        const totalSqm = turfArea({ type: 'Feature', geometry: field.boundary_geojson as any, properties: {} });
        totalAcres = totalSqm * SQM_TO_AC;

        if (field.has_irrigated_boundary && field.irrigated_boundary_geojson) {
          // Intersect the entire irrigated MultiPolygon with the field boundary
          // in a single call — handles overlapping pivots without double-counting
          let irrigatedSqm = 0;
          try {
            const fieldFeature = { type: 'Feature' as const, geometry: field.boundary_geojson as any, properties: {} };
            const irrigFeature = { type: 'Feature' as const, geometry: field.irrigated_boundary_geojson as any, properties: {} };
            const fc = { type: 'FeatureCollection' as const, features: [fieldFeature, irrigFeature] };
            const intersectFn = (turfIntersect as any).intersect
              || (turfIntersect as any).default
              || turfIntersect;
            const clipped = intersectFn(fc);
            if (clipped) {
              irrigatedSqm = turfArea({ type: 'Feature', geometry: clipped.geometry, properties: {} });
            }
          } catch {
            // Fallback to stored area capped at total
            const irrigatedUnit = field.irrigated_boundary_area_unit || 'ha';
            const fallbackAc = field.irrigated_boundary_area_value
              ? convertArea(field.irrigated_boundary_area_value, irrigatedUnit, 'ac')
              : 0;
            irrigatedSqm = Math.min(fallbackAc, totalAcres) / SQM_TO_AC;
          }
          irrigatedAcres = Math.min(irrigatedSqm * SQM_TO_AC, totalAcres);
        }
      }

      const drylandAcres = Math.max(0, totalAcres - irrigatedAcres);

      return {
        field,
        operation: op,
        analysis,
        irrigatedAcres,
        drylandAcres,
        totalAcres: op.area_value || totalAcres,
      };
    })
    .sort((a, b) => a.field.name.localeCompare(b.field.name));
}
