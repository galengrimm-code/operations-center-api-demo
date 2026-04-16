'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Map, Grid3X3, BarChart3, FileBarChart } from 'lucide-react';

const links = [
  { href: '/map', label: 'Map', icon: Map },
  { href: '/fields', label: 'Fields', icon: Grid3X3 },
  { href: '/operations', label: 'Operations', icon: BarChart3 },
  { href: '/reports', label: 'Reports', icon: FileBarChart },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {links.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
              ${isActive
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }
            `}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
