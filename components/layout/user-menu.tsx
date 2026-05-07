"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { Settings, LogOut, Building2, ChevronDown } from "lucide-react";

export function UserMenu() {
  const router = useRouter();
  const { user, signOut, johnDeereConnection } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const orgName = johnDeereConnection?.selected_org_name;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-white/5"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/20">
          <span className="text-xs font-semibold text-emerald-400">
            {user?.email?.[0]?.toUpperCase() || "?"}
          </span>
        </div>
        {orgName && (
          <span className="hidden max-w-[120px] truncate text-xs text-slate-400 md:inline">
            {orgName}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="glass-panel absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl">
          <div className="border-b border-white/5 px-4 py-3">
            <p className="text-xs text-slate-500">Signed in as</p>
            <p className="truncate text-sm text-slate-200">{user?.email}</p>
            {orgName && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Building2 className="h-3 w-3 text-emerald-500" />
                <p className="truncate text-xs text-emerald-400">{orgName}</p>
              </div>
            )}
          </div>
          <div className="py-1.5">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
