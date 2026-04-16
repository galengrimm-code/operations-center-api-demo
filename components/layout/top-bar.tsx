'use client';

import Link from 'next/link';
import { Tractor } from 'lucide-react';
import { NavLinks } from './nav-links';
import { UserMenu } from './user-menu';
import { ClientFilterDropdown } from './client-filter-dropdown';

export function TopBar() {
  return (
    <header className="h-12 glass-panel border-b border-white/[0.06] sticky top-0 z-50">
      <div className="h-full px-4 flex items-center justify-between">
        {/* Logo */}
        <Link href="/map" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:shadow-emerald-500/40 transition-shadow">
            <Tractor className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-200 tracking-tight hidden sm:inline">
            Farm Data Hub
          </span>
        </Link>

        {/* Center nav */}
        <NavLinks />

        <div className="flex items-center gap-3">
          <ClientFilterDropdown />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
