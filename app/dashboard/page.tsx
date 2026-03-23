'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { JohnDeereConnect } from '@/components/dashboard/john-deere-connect';
import { OrganizationSelector } from '@/components/dashboard/organization-selector';
import { FieldMap } from '@/components/dashboard/field-map';
import { FieldsList } from '@/components/dashboard/fields-list';
import { HarvestOperations } from '@/components/dashboard/harvest-operations';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader as Loader2, LogOut, Tractor, Map, MapPin, Wheat, User } from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, signOut, johnDeereConnection, refreshJohnDeereConnection } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  const handleOrganizationChange = () => {
    setRefreshKey((k) => k + 1);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
                <Tractor className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-semibold text-slate-900">Farm Data Hub</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <User className="w-4 h-4" />
                <span>{user.email}</span>
              </div>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-600 mt-1">Manage your John Deere Operations Center connection and view farm data</p>
        </div>

        <div className="space-y-6">
          <JohnDeereConnect />

          {johnDeereConnection && (
            <>
              <OrganizationSelector onOrganizationChange={handleOrganizationChange} />

              {johnDeereConnection.selected_org_id && (
                <Tabs defaultValue="map" className="w-full">
                  <TabsList className="bg-white border border-slate-200 p-1">
                    <TabsTrigger
                      value="map"
                      className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
                    >
                      <Map className="w-4 h-4 mr-2" />
                      Map
                    </TabsTrigger>
                    <TabsTrigger
                      value="fields"
                      className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
                    >
                      <MapPin className="w-4 h-4 mr-2" />
                      Fields
                    </TabsTrigger>
                    <TabsTrigger
                      value="harvest"
                      className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
                    >
                      <Wheat className="w-4 h-4 mr-2" />
                      Harvest Operations
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="map" className="mt-4">
                    <FieldMap key={`map-${refreshKey}`} />
                  </TabsContent>

                  <TabsContent value="fields" className="mt-4">
                    <FieldsList key={`fields-${refreshKey}`} />
                  </TabsContent>

                  <TabsContent value="harvest" className="mt-4">
                    <HarvestOperations key={`harvest-${refreshKey}`} />
                  </TabsContent>
                </Tabs>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
