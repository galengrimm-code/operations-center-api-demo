'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useClientFilter } from '@/contexts/client-filter-context';
import { supabase } from '@/lib/supabase';
import { Users } from 'lucide-react';

export function ClientFilterDropdown() {
  const { user, johnDeereConnection } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id;
  const { selectedClient, setSelectedClient, availableClients, setAvailableClients } = useClientFilter();

  useEffect(() => {
    if (!user || !orgId) return;

    const loadClients = async () => {
      const { data } = await (supabase.from('fields') as any)
        .select('client_name')
        .eq('user_id', user.id)
        .eq('org_id', orgId)
        .not('client_name', 'is', null);

      if (data) {
        const clients = Array.from(new Set((data as Array<{ client_name: string }>).map(d => d.client_name))).sort() as string[];
        setAvailableClients(clients);
      }
    };

    loadClients();
  }, [user, orgId, setAvailableClients]);

  if (availableClients.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Users className="w-3.5 h-3.5 text-slate-500" />
      <select
        value={selectedClient || ''}
        onChange={(e) => setSelectedClient(e.target.value || null)}
        className="bg-transparent border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">All Clients</option>
        {availableClients.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
