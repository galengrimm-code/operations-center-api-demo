'use client';

import { useEffect, useState } from 'react';
import { EyeOff, Loader2, Check } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';
import { COMMON_COVER_CROPS } from '@/lib/crop-filter';
import { formatCropName } from '@/lib/reports-data';

export function HiddenCropsSection() {
  const { user, johnDeereConnection, updateHiddenCrops } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id;
  const currentHidden = johnDeereConnection?.hidden_crop_names || [];

  const [availableCrops, setAvailableCrops] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set(currentHidden));

  useEffect(() => {
    setPending(new Set(currentHidden));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [johnDeereConnection?.hidden_crop_names?.join(',')]);

  useEffect(() => {
    if (!user || !orgId) { setLoading(false); return; }
    const loadCrops = async () => {
      const { data } = await (supabase
        .from('field_operations') as any)
        .select('crop_name')
        .eq('user_id', user.id)
        .eq('org_id', orgId)
        .not('crop_name', 'is', null);
      const imported = Array.from(new Set(((data || []) as Array<{ crop_name: string }>).map((r) => r.crop_name)));
      const combined = Array.from(new Set([...imported, ...COMMON_COVER_CROPS])).sort();
      setAvailableCrops(combined);
      setLoading(false);
    };
    loadCrops();
  }, [user, orgId]);

  const toggle = (crop: string) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(crop)) next.delete(crop);
      else next.add(crop);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateHiddenCrops(Array.from(pending).sort());
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  const isDirty =
    pending.size !== currentHidden.length ||
    Array.from(pending).some((c) => !currentHidden.includes(c));

  if (!johnDeereConnection) return null;

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <EyeOff className="w-4 h-4 text-emerald-500" />
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Hide Crops</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Hide cover crops (rye, grassland, etc.) from Reports, Operations, and all dropdowns site-wide. Data stays imported; only display is affected.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading crops...
        </div>
      ) : availableCrops.length === 0 ? (
        <p className="text-sm text-slate-500 py-2">No crops imported yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {availableCrops.map((crop) => {
            const hidden = pending.has(crop);
            return (
              <button
                key={crop}
                onClick={() => toggle(crop)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition-all ${
                  hidden
                    ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                    : 'bg-white/[0.03] border border-white/[0.06] text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                <span>{formatCropName(crop)}</span>
                <span className="text-xs opacity-60">{hidden ? 'Hidden' : 'Shown'}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : justSaved ? <Check className="w-4 h-4" /> : null}
          {justSaved ? 'Saved' : saving ? 'Saving...' : 'Save'}
        </button>
        {pending.size > 0 && (
          <span className="text-xs text-slate-500">
            {pending.size} hidden
          </span>
        )}
      </div>
    </div>
  );
}
