'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { fetchOrganizations, selectOrganization, disconnectJohnDeere } from '@/lib/john-deere-client';
import { Building2, Ruler, Unlink, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { JohnDeereOrganization } from '@/types/john-deere';
import { HiddenCropsSection } from '@/components/settings/hidden-crops-section';

export default function SettingsPage() {
  const { user, johnDeereConnection, refreshJohnDeereConnection, updatePreferredAreaUnit } = useAuth();
  const [orgs, setOrgs] = useState<JohnDeereOrganization[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState(johnDeereConnection?.selected_org_id || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const preferredUnit = johnDeereConnection?.preferred_area_unit || 'ac';

  useEffect(() => {
    if (johnDeereConnection) {
      setOrgsLoading(true);
      fetchOrganizations()
        .then(data => setOrgs(data.values || []))
        .catch(() => {})
        .finally(() => setOrgsLoading(false));
    }
  }, [johnDeereConnection]);

  useEffect(() => {
    if (johnDeereConnection?.selected_org_id) {
      setSelectedOrgId(johnDeereConnection.selected_org_id);
    }
  }, [johnDeereConnection?.selected_org_id]);

  const handleSaveOrg = async () => {
    const org = orgs.find(o => o.id === selectedOrgId);
    if (!org) return;
    setIsSaving(true);
    try {
      await selectOrganization(org.id, org.name);
      await refreshJohnDeereConnection();
    } catch {}
    setIsSaving(false);
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectJohnDeere();
      await refreshJohnDeereConnection();
    } catch {}
    setIsDisconnecting(false);
    setShowDisconnectConfirm(false);
  };

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-white">Settings</h1>

        {/* Account */}
        <div className="glass rounded-xl p-5">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">Account</h2>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <span className="text-sm font-semibold text-emerald-400">
                {user?.email?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
            <div>
              <p className="text-sm text-white">{user?.email}</p>
              <p className="text-xs text-slate-500">Supabase Auth</p>
            </div>
          </div>
        </div>

        {/* Organization */}
        {johnDeereConnection && (
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="w-4 h-4 text-emerald-500" />
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Organization</h2>
            </div>

            {orgsLoading ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                <span className="text-sm text-slate-400">Loading organizations...</span>
              </div>
            ) : (
              <div className="space-y-3">
                {orgs.map(org => (
                  <button
                    key={org.id}
                    onClick={() => setSelectedOrgId(org.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all ${
                      selectedOrgId === org.id
                        ? 'bg-emerald-500/15 border border-emerald-500/30'
                        : 'bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className={`text-sm ${selectedOrgId === org.id ? 'text-white' : 'text-slate-300'}`}>
                      {org.name}
                    </span>
                    {org.id === johnDeereConnection.selected_org_id && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    )}
                  </button>
                ))}

                {selectedOrgId !== johnDeereConnection.selected_org_id && (
                  <button
                    onClick={handleSaveOrg}
                    disabled={isSaving}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Switch Organization'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Area Units */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Ruler className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Area Units</h2>
          </div>
          <div className="flex gap-2">
            {['ac', 'ha'].map(unit => (
              <button
                key={unit}
                onClick={() => updatePreferredAreaUnit(unit)}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  preferredUnit === unit
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                    : 'bg-white/[0.03] border border-white/[0.06] text-slate-400 hover:bg-white/[0.06]'
                }`}
              >
                {unit === 'ac' ? 'Acres' : 'Hectares'}
              </button>
            ))}
          </div>
        </div>

        {/* Hide Crops */}
        <HiddenCropsSection />

        {/* Disconnect */}
        {johnDeereConnection && (
          <div className="glass rounded-xl p-5 border-red-500/10">
            <div className="flex items-center gap-2 mb-4">
              <Unlink className="w-4 h-4 text-red-400" />
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Disconnect</h2>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              Remove your John Deere Operations Center connection. This will clear all stored tokens.
            </p>
            {showDisconnectConfirm ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Are you sure?</span>
                </div>
                <button
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-xl text-sm text-red-400 font-medium transition-colors disabled:opacity-50"
                >
                  {isDisconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Yes, Disconnect'}
                </button>
                <button
                  onClick={() => setShowDisconnectConfirm(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDisconnectConfirm(true)}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-sm text-red-400 font-medium transition-colors"
              >
                Disconnect John Deere
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
