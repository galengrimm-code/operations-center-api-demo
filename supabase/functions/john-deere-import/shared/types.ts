// supabase/functions/john-deere-import/shared/types.ts

export interface JdEventMeasurement {
  "@type"?: string;
  value?: number;
  unitId?: string;
  variableRepresentation?: string;
  edited?: boolean;
}

export interface JdProductTotal {
  "@type"?: string;
  productId?: string;
  name?: string;
  brand?: string;
  carrier?: boolean;
  totalMaterial?: JdEventMeasurement;
  averageMaterial?: JdEventMeasurement;
}

export interface JdApplicationProductTotal {
  "@type"?: string;
  productId?: string;
  name?: string;
  area?: JdEventMeasurement;
  averageSpeed?: JdEventMeasurement;
  totalMaterial?: JdEventMeasurement;
  averageMaterial?: JdEventMeasurement;
  appliedArea?: JdEventMeasurement;
  productTotals?: JdProductTotal[];
}

export interface JdApplicationRateResult {
  "@type"?: string;
  measurementName?: string;
  measurementCategory?: string;
  varietyTotals?: unknown[];
  applicationProductTotals?: JdApplicationProductTotal[];
  links?: Array<{ rel: string; uri: string }>;
}

// Flat output for the merge layer
export interface ExtractedProductLine {
  line_index: number;          // global counter across all outer aggregates
  outer_aggregate_index: number; // which applicationProductTotals[i] this came from
  jd_product_id: string;
  name: string;
  brand: string | null;
  is_carrier: boolean;
  rate_value: number | null;
  rate_unit: string | null;
  rate_variable: string | null;
  total_value: number | null;
  total_unit: string | null;
  total_variable: string | null;
  area_value: number | null;
  area_unit: string | null;
  raw_response: JdProductTotal;
}
