"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Map,
  Grid3X3,
  BarChart3,
  FileBarChart,
  TrendingUp,
  Droplets,
  Package,
  Mountain,
} from "lucide-react";

const links = [
  { href: "/map", label: "Map", icon: Map },
  { href: "/fields", label: "Fields", icon: Grid3X3 },
  { href: "/operations", label: "Operations", icon: BarChart3 },
  { href: "/progress", label: "Progress", icon: TrendingUp },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/applications", label: "Applications", icon: Droplets },
  { href: "/products", label: "Products", icon: Package },
  { href: "/elevation", label: "Elevation", icon: Mountain },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {links.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
              isActive
                ? "bg-emerald-500/15 text-emerald-400"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            } `}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
