'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { TopBar } from '@/components/layout/top-bar';
import { ConnectOverlay } from '@/components/overlays/connect-overlay';
import { OrgSelectorOverlay } from '@/components/overlays/org-selector-overlay';
import { ClientFilterProvider } from '@/contexts/client-filter-context';
import { Loader2 } from 'lucide-react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, johnDeereConnection } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const needsConnection = !johnDeereConnection;
  const needsOrg = johnDeereConnection && !johnDeereConnection.selected_org_id;

  return (
    <ClientFilterProvider>
      <div className="min-h-screen bg-slate-950">
        <TopBar />
        {children}
        {needsConnection && <ConnectOverlay />}
        {needsOrg && <OrgSelectorOverlay />}
      </div>
    </ClientFilterProvider>
  );
}
