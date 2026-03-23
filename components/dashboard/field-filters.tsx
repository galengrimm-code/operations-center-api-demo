'use client';

import { useMemo } from 'react';
import { Users, Chrome as Home } from 'lucide-react';
import type { StoredField } from '@/types/john-deere';

interface FieldFiltersProps {
  fields: StoredField[];
  selectedClient: string | null;
  selectedFarm: string | null;
  onClientChange: (client: string | null) => void;
  onFarmChange: (farm: string | null) => void;
}

export function FieldFilters({
  fields,
  selectedClient,
  selectedFarm,
  onClientChange,
  onFarmChange,
}: FieldFiltersProps) {
  const clients = useMemo(() => {
    const names = new Set<string>();
    for (const f of fields) {
      if (f.client_name) names.add(f.client_name);
    }
    return Array.from(names).sort();
  }, [fields]);

  const farms = useMemo(() => {
    const relevantFields = selectedClient
      ? fields.filter(f => f.client_name === selectedClient)
      : fields;
    const names = new Set<string>();
    for (const f of relevantFields) {
      if (f.farm_name) names.add(f.farm_name);
    }
    return Array.from(names).sort();
  }, [fields, selectedClient]);

  const filteredCount = useMemo(() => {
    let result = fields;
    if (selectedClient) result = result.filter(f => f.client_name === selectedClient);
    if (selectedFarm) result = result.filter(f => f.farm_name === selectedFarm);
    return result.length;
  }, [fields, selectedClient, selectedFarm]);

  const hasClients = clients.length > 0;
  const hasFarms = farms.length > 0;

  if (!hasClients && !hasFarms) return null;

  const isFiltering = selectedClient !== null || selectedFarm !== null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 space-y-3">
      {hasClients && (
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 uppercase tracking-wide pt-1 shrink-0">
            <Users className="w-3.5 h-3.5" />
            <span>Client</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => {
                onClientChange(null);
                onFarmChange(null);
              }}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${
                selectedClient === null
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All
            </button>
            {clients.map(name => (
              <button
                key={name}
                onClick={() => {
                  if (selectedClient === name) {
                    onClientChange(null);
                    onFarmChange(null);
                  } else {
                    onClientChange(name);
                    onFarmChange(null);
                  }
                }}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  selectedClient === name
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasFarms && (
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 uppercase tracking-wide pt-1 shrink-0">
            <Home className="w-3.5 h-3.5" />
            <span>Farm</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onFarmChange(null)}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${
                selectedFarm === null
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All
            </button>
            {farms.map(name => (
              <button
                key={name}
                onClick={() => {
                  onFarmChange(selectedFarm === name ? null : name);
                }}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  selectedFarm === name
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {isFiltering && (
        <div className="text-xs text-slate-500 pt-1 border-t border-slate-100">
          Showing {filteredCount} of {fields.length} field{fields.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
