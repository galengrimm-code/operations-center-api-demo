"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { fetchOrganizations, selectOrganization } from "@/lib/john-deere-client";
import { Building2, Loader2, ArrowRight, AlertCircle } from "lucide-react";
import type { JohnDeereOrganization } from "@/types/john-deere";

export function OrgSelectorOverlay() {
  const { johnDeereConnection, refreshJohnDeereConnection } = useAuth();
  const [organizations, setOrganizations] = useState<JohnDeereOrganization[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (johnDeereConnection) {
      loadOrgs();
    }
  }, [johnDeereConnection]);

  const loadOrgs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchOrganizations();
      setOrganizations(data.values || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load organizations");
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!selectedId) return;
    const org = organizations.find((o) => o.id === selectedId);
    if (!org) return;

    setIsSaving(true);
    try {
      await selectOrganization(org.id, org.name);
      await refreshJohnDeereConnection();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select organization");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Card */}
      <div className="glass-panel relative mx-4 w-full max-w-lg rounded-2xl p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
            <Building2 className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Select Organization</h2>
            <p className="text-sm text-slate-400">Choose which account to view</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-400" />
            <p className="mb-4 text-sm text-red-400">{error}</p>
            <button
              onClick={loadOrgs}
              className="text-sm text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* Org list */}
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => setSelectedId(org.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all ${
                    selectedId === org.id
                      ? "bg-emerald-500/15 border border-emerald-500/30 text-white"
                      : "border border-white/[0.06] bg-white/[0.03] text-slate-300 hover:border-white/[0.1] hover:bg-white/[0.06]"
                  } `}
                >
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                      selectedId === org.id ? "bg-emerald-500/20" : "bg-white/5"
                    }`}
                  >
                    <Building2
                      className={`h-4 w-4 ${selectedId === org.id ? "text-emerald-400" : "text-slate-500"}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{org.name}</p>
                    {org.type && <p className="truncate text-xs text-slate-500">{org.type}</p>}
                  </div>
                  {selectedId === org.id && (
                    <div className="h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
                  )}
                </button>
              ))}
              {organizations.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">
                  No organizations found in your account.
                </p>
              )}
            </div>

            {/* Continue button */}
            {organizations.length > 0 && (
              <button
                onClick={handleContinue}
                disabled={!selectedId || isSaving}
                className={`mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl px-6 py-3 font-medium transition-all ${
                  selectedId
                    ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 hover:bg-emerald-400"
                    : "cursor-not-allowed bg-white/5 text-slate-500"
                } `}
              >
                {isSaving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
