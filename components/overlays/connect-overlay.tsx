"use client";

import { useAuth } from "@/contexts/auth-context";
import { getJohnDeereAuthUrl } from "@/lib/john-deere-client";
import { Link2, LogOut, Tractor } from "lucide-react";

export function ConnectOverlay() {
  const { signOut } = useAuth();

  const handleConnect = () => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    const state = crypto.randomUUID();
    sessionStorage.setItem("jd_oauth_state", state);
    const authUrl = getJohnDeereAuthUrl(redirectUri, state);
    window.location.href = authUrl;
  };

  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/login";
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Card */}
      <div className="glass-panel relative mx-4 w-full max-w-md rounded-2xl p-8 text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
          <Tractor className="h-8 w-8 text-emerald-400" />
        </div>

        <h2 className="mb-2 text-xl font-semibold text-white">Connect to Operations Center</h2>
        <p className="mb-8 text-sm leading-relaxed text-slate-400">
          Link your John Deere account to access your fields, operations, and farm data in one
          place.
        </p>

        {/* Connect button */}
        <button
          onClick={handleConnect}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-500 px-6 py-3 font-medium text-white shadow-lg shadow-emerald-500/25 transition-colors hover:bg-emerald-400"
        >
          <Link2 className="h-5 w-5" />
          Connect John Deere Account
        </button>

        {/* Sign out link */}
        <button
          onClick={handleSignOut}
          className="mx-auto mt-4 flex items-center justify-center gap-2 text-sm text-slate-500 transition-colors hover:text-slate-300"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out instead
        </button>
      </div>
    </div>
  );
}
