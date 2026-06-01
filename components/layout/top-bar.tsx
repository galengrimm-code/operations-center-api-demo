"use client";

import Link from "next/link";
import Image from "next/image";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import { ClientFilterDropdown } from "./client-filter-dropdown";

export function TopBar() {
  return (
    <header className="glass-panel sticky top-0 z-50 h-12 border-b border-white/[0.06]">
      <div className="flex h-full items-center justify-between px-4">
        {/* Logo */}
        <Link href="/map" className="group flex items-center gap-2.5">
          <Image
            src="/android-chrome-192x192.png"
            alt="Farm Data Hub"
            width={28}
            height={28}
            priority
            className="h-7 w-7 rounded-lg shadow-lg shadow-emerald-500/20 transition-shadow group-hover:shadow-emerald-500/40"
          />
          <span className="hidden text-sm font-semibold tracking-tight text-slate-200 sm:inline">
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
