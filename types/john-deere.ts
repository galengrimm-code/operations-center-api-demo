export interface JohnDeereOrganization {
  id: string;
  name: string;
  type: string;
  links: JohnDeereLink[];
}

export interface JohnDeereBoundaryPoint {
  '@type': 'Point';
  lat: number;
  lon: number;
}

export interface JohnDeereRing {
  '@type': 'Ring';
  points: JohnDeereBoundaryPoint[];
  type: string;
  passable: boolean;
}

export interface JohnDeerePolygon {
  '@type': 'Polygon';
  rings: JohnDeereRing[];
}

export interface JohnDeereMeasurement {
  '@type': 'MeasurementAsDouble';
  valueAsDouble: number;
  unit: string;
}

export interface JohnDeereBoundary {
  id: string;
  name?: string;
  area?: JohnDeereMeasurement;
  multipolygons: JohnDeerePolygon[];
  active: boolean;
  links: JohnDeereLink[];
}

export interface JohnDeereField {
  id: string;
  name: string;
  activeBoundary?: JohnDeereBoundary;
  boundaries?: unknown;
  links: JohnDeereLink[];
}

export interface JohnDeereFieldOperation {
  id: string;
  type: string;
  startDate: string;
  endDate?: string;
  field?: {
    id: string;
    name: string;
  };
  crop?: {
    name: string;
  };
  variety?: {
    name: string;
  };
  harvestMoisture?: number;
  totalYield?: {
    value: number;
    unit: string;
  };
  links: JohnDeereLink[];
}

export interface JohnDeereLink {
  rel: string;
  uri: string;
}

export interface JohnDeereApiResponse<T> {
  values: T[];
  links: JohnDeereLink[];
  total?: number;
  page?: number;
  totalPages?: number;
}

export interface StoredField {
  id: string;
  user_id: string;
  org_id: string;
  jd_field_id: string;
  name: string;
  boundary_geojson: GeoJSON.MultiPolygon | null;
  boundary_area_value: number | null;
  boundary_area_unit: string | null;
  active_boundary: boolean;
  client_name: string | null;
  client_id: string | null;
  farm_name: string | null;
  farm_id: string | null;
  imported_at: string;
  created_at: string;
  updated_at: string;
}

export interface ImportFieldsResponse {
  fields: StoredField[];
  totalImported: number;
  withoutBoundaries: number;
}

export interface JohnDeereTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}
