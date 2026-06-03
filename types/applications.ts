// types/applications.ts

export type ProductCategory =
  | "fertilizer"
  | "chemical"
  | "seed"
  | "adjuvant"
  | "other";

export interface Product {
  id: string;
  user_id: string;
  org_id: string;
  jd_product_id: string;
  name: string;
  name_normalized: string;
  brand: string | null;
  is_carrier_default: boolean;
  product_kind: "constituent" | "tank_mix_recipe" | null;
  product_category: ProductCategory | string | null;  // free text but typed for known set
  product_category_source: "seed" | "user" | null;
  default_unit: string | null;
  density_lbs_per_gal: number | null;
  nutrient_content_pct: number | null;
  price_unit_default: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface FieldOperationProductLine {
  id: string;
  user_id: string;
  org_id: string;
  field_operation_id: string;
  product_id: string;
  line_index: number;
  product_category_override: string | null;
  is_carrier: boolean;

  // Live editable
  rate_value: number | null;
  rate_unit: string | null;
  rate_variable: string | null;
  total_value: number | null;
  total_unit: string | null;
  total_variable: string | null;
  area_value: number | null;
  area_unit: string | null;

  // JD originals
  rate_value_jd_original: number | null;
  total_value_jd_original: number | null;
  area_value_jd_original: number | null;

  // Edit tracking
  is_user_edited: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationOperation {
  id: string;
  user_id: string;
  org_id: string;
  jd_field_id: string;
  jd_operation_id: string;
  operation_type: "application";
  crop_season: string | null;
  start_date: string | null;
  end_date: string | null;
  application_name: string | null;
  application_name_jd_original: string | null;
  application_name_user_edited: boolean;
  measurement_status: "available" | "not_found" | "error" | "unknown";
}

export interface ApplicationWithLines extends ApplicationOperation {
  field_name: string;
  farm_name: string | null;
  product_lines: Array<FieldOperationProductLine & { product: Product; cost?: LineCost; applied_acres?: number | null }>;
}

export interface ProductPrice {
  id: string;
  user_id: string;
  org_id: string;
  product_id: string;
  year: number;
  price_per_unit: number;
  price_unit: string;
  created_at: string;
  updated_at: string;
}

// per-line derived cost, attached at fetch time.
// null fields mean "unknown" (unpriced / unconvertible / bad area) and render as "—", never $0.00.
export interface LineCost {
  cost_per_acre: number | null;
  total_cost: number | null;
  price_per_unit: number | null;
  price_unit: string | null;
  needs_density: boolean; // cross-family with no density set
}

export interface ProductLineEdit {
  rate_value?: number | null;
  total_value?: number | null;
  area_value?: number | null;
  product_category_override?: string | null;
}
