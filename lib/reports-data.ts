import { supabase } from './supabase';
import { convertArea } from './area-utils';
import type { StoredField, StoredFieldOperation, IrrigationAnalysisResult } from '@/types/john-deere';

export interface ReportRow {
  field: StoredField;
  operation: StoredFieldOperation;
  analysis: IrrigationAnalysisResult | null;
  irrigatedAcres: number;
  drylandAcres: number;
  totalAcres: number;
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

      // Convert boundary areas to acres (stored values may be in hectares)
      const boundaryUnit = field.boundary_area_unit || 'ha';
      const irrigatedUnit = field.irrigated_boundary_area_unit || 'ha';
      const totalAcres = field.boundary_area_value
        ? convertArea(field.boundary_area_value, boundaryUnit, 'ac')
        : 0;
      const rawIrrigatedAcres = field.irrigated_boundary_area_value
        ? convertArea(field.irrigated_boundary_area_value, irrigatedUnit, 'ac')
        : 0;
      // Cap irrigated at total field area (pivot circles can extend beyond field boundary)
      const irrigatedAcres = Math.min(rawIrrigatedAcres, totalAcres);
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
