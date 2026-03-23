'use client';

import { useMemo } from 'react';
import { MapPin, Users, Chrome as Home } from 'lucide-react';
import { formatArea } from '@/lib/area-utils';
import type { StoredField } from '@/types/john-deere';

interface FieldsListProps {
  fields: StoredField[];
  selectedClient: string | null;
  selectedFarm: string | null;
  preferredUnit: string;
  isLoading: boolean;
  error: string | null;
}

export function FieldsList({
  fields,
  selectedClient,
  selectedFarm,
  preferredUnit,
  isLoading,
  error,
}: FieldsListProps) {
  const filtered = useMemo(() => {
    let result = fields;
    if (selectedClient) result = result.filter(f => f.client_name === selectedClient);
    if (selectedFarm) result = result.filter(f => f.farm_name === selectedFarm);
    return result;
  }, [fields, selectedClient, selectedFarm]);

  if (isLoading && fields.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-500">Loading fields...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="text-center py-8">
          <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No fields imported yet. Use the Map tab to import fields.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
          <MapPin className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Fields</h3>
          <p className="text-sm text-slate-500">
            {filtered.length === fields.length
              ? `${fields.length} field${fields.length !== 1 ? 's' : ''}`
              : `${filtered.length} of ${fields.length} fields`}
          </p>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-slate-500">No fields match the current filters</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filtered.map(field => {
            const area = formatArea(
              field.boundary_area_value,
              field.boundary_area_unit,
              preferredUnit
            );

            return (
              <div key={field.id} className="px-6 py-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 shrink-0">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${
                          field.boundary_geojson ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                        title={field.boundary_geojson ? 'Has boundary' : 'No boundary'}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{field.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {field.client_name && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 px-2 py-0.5 text-xs font-medium">
                            <Users className="w-3 h-3" />
                            {field.client_name}
                          </span>
                        )}
                        {field.farm_name && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-xs font-medium">
                            <Home className="w-3 h-3" />
                            {field.farm_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {area && (
                    <span className="text-sm text-slate-500 shrink-0 tabular-nums">
                      {area}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
