'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { useClientFilter } from '@/contexts/client-filter-context';
import { useFields } from '@/hooks/use-fields';
import { formatArea } from '@/lib/area-utils';
import { MapPin, Loader2, Download, Search, X } from 'lucide-react';

export default function FieldsPage() {
  const { johnDeereConnection } = useAuth();
  const { selectedFarm: globalFarm } = useClientFilter();
  const { fields, loading, error, importFields, isImporting } = useFields();
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  const preferredUnit = johnDeereConnection?.preferred_area_unit || 'ac';

  const clients = useMemo(() => {
    const set = new Set<string>();
    fields.forEach(f => { if (f.client_name) set.add(f.client_name); });
    return Array.from(set).sort();
  }, [fields]);

  const filtered = useMemo(() => {
    let result = fields;
    if (globalFarm) result = result.filter(f => f.farm_name === globalFarm);
    if (selectedClient) result = result.filter(f => f.client_name === selectedClient);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(f =>
        f.name.toLowerCase().includes(q) ||
        f.client_name?.toLowerCase().includes(q) ||
        f.farm_name?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [fields, globalFarm, selectedClient, search]);

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-white">Fields</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {fields.length} field{fields.length !== 1 ? 's' : ''} imported
            </p>
          </div>
          <button
            onClick={importFields}
            disabled={isImporting || loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/20 rounded-xl text-sm font-medium text-emerald-400 transition-colors disabled:opacity-50"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isImporting ? 'Importing...' : 'Import Fields'}
          </button>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search fields..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-xl text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/30 focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>
          {clients.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {clients.map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedClient(selectedClient === c ? null : c)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedClient === c
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:bg-white/[0.06]'
                  }`}
                >
                  {c}
                  {selectedClient === c && <X className="w-3 h-3" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && fields.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="glass rounded-xl p-4 border-red-500/20 bg-red-500/10 mb-6">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && fields.length === 0 && !error && (
          <div className="text-center py-20">
            <MapPin className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No fields imported yet.</p>
            <p className="text-sm text-slate-500 mt-1">Import your fields to see them here.</p>
          </div>
        )}

        {/* Fields grid */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(field => (
              <Link
                key={field.id}
                href={`/map/field/${field.jd_field_id}`}
                className="group glass rounded-xl p-4 hover:bg-white/[0.06] transition-all hover:border-emerald-500/20"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="text-sm font-medium text-white group-hover:text-emerald-300 transition-colors truncate">
                    {field.name}
                  </h3>
                  {field.boundary_geojson && (
                    <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 mt-1.5" />
                  )}
                </div>

                {field.boundary_area_value && (
                  <p className="text-sm font-mono-data text-emerald-400 mb-2">
                    {formatArea(field.boundary_area_value, field.boundary_area_unit, preferredUnit)}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {field.client_name && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/10 text-[11px] text-sky-300">
                      <span className="w-1 h-1 rounded-full bg-sky-400" />
                      {field.client_name}
                    </span>
                  )}
                  {field.farm_name && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-[11px] text-amber-300">
                      <span className="w-1 h-1 rounded-full bg-amber-400" />
                      {field.farm_name}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* No results from search */}
        {!loading && fields.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-500 text-sm">No fields match your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}
