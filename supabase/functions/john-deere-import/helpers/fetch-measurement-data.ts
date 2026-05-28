import { JOHN_DEERE_API_BASE } from "../../_shared/john-deere.ts";

// Map operation type to the primary measurement type name
export const MEASUREMENT_TYPE_MAP: Record<string, string> = {
  harvest: "HarvestYieldResult",
  seeding: "SeedingRateResult",
  application: "ApplicationRateResult",
  tillage: "TillageDepthResult",
};

export interface MeasurementResult {
  area_value?: number;
  area_unit?: string;
  avg_yield_value?: number;
  avg_yield_unit?: string;
  avg_moisture?: number;
  total_wet_mass_value?: number;
  total_wet_mass_unit?: string;
  measurement_type?: string;
}

export async function fetchMeasurementData(
  accessToken: string,
  operationId: string,
  operationType: string,
): Promise<MeasurementResult> {
  const measurementType = MEASUREMENT_TYPE_MAP[operationType];
  if (!measurementType) return {};

  try {
    const response = await fetch(
      `${JOHN_DEERE_API_BASE}/fieldOperations/${operationId}/measurementTypes/${measurementType}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.deere.axiom.v3+json",
          "Accept-UOM-System": "ENGLISH",
          "Accept-Yield-Preference": "VOLUME",
        },
      },
    );
    if (!response.ok) return {};

    const data = await response.json();
    return {
      area_value: data.area?.value,
      area_unit: data.area?.unitId,
      avg_yield_value: data.averageYield?.value,
      avg_yield_unit: data.averageYield?.unitId,
      avg_moisture: data.averageMoisture?.value,
      total_wet_mass_value: data.wetMass?.value,
      total_wet_mass_unit: data.wetMass?.unitId,
      measurement_type: measurementType,
    };
  } catch (_) {
    return {};
  }
}
