'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useClientFilter } from '@/contexts/client-filter-context';
import { supabase } from '@/lib/supabase';
import { Users } from 'lucide-react';

export function ClientFilterDropdown() {
  const { user, johnDeereConnection } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id;
  const { selectedFarm, setSelectedFarm, availableFarms, setAvailableFarms } = useClientFilter();

  useEffect(() => {
    if (!user || !orgId) return;

    const loadFarms = async () => {
      const { data } = await (supabase.from('fields') as any)
        .select('farm_name')
        .eq('user_id', user.id)
        .eq('org_id', orgId)
        .not('farm_name', 'is', null);

      if (data) {
        const farms = Array.from(new Set((data as Array<{ farm_name: string }>).map(d => d.farm_name))).sort() as string[];
        setAvailableFarms(farms);
      }
    };

    loadFarms();
  }, [user, orgId, setAvailableFarms]);

  if (availableFarms.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Users className="w-3.5 h-3.5 text-slate-500" />
      <select
        value={selectedFarm || ''}
        onChange={(e) => setSelectedFarm(e.target.value || null)}
        className="bg-transparent border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">All Farms</option>
        {availableFarms.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    </div>
  );
}
