"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

interface ClientFilterContextType {
  selectedFarm: string | null;
  setSelectedFarm: (farm: string | null) => void;
  availableFarms: string[];
  setAvailableFarms: (farms: string[]) => void;
}

const ClientFilterContext = createContext<ClientFilterContextType | undefined>(undefined);

const STORAGE_KEY = "ops-center-farm-filter";

// Product decision (2026-06-11): the app opens scoped to the home operation,
// not "All Farms". An explicit user choice (including "All Farms", stored as
// "") always wins over this default.
const DEFAULT_FARM = "Precision Farms";

export function ClientFilterProvider({ children }: { children: ReactNode }) {
  const [selectedFarm, setSelectedFarmState] = useState<string | null>(null);
  const [availableFarms, setAvailableFarms] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount. "" = explicit "All Farms"; absent = never chosen.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setSelectedFarmState(stored);
    setHydrated(true);
  }, []);

  // Keep the selection valid for the active org's farm list, then apply the
  // default when the user has no explicit stored choice. (Legacy note: before
  // 2026-06-11 an explicit "All Farms" was stored by REMOVING the key, so it
  // is indistinguishable from never-chosen and gets the default once — an
  // accepted one-time behavior change; re-picking All Farms persists it.)
  useEffect(() => {
    if (!hydrated || availableFarms.length === 0) return;
    if (selectedFarm && !availableFarms.includes(selectedFarm)) {
      // Org switch: this org doesn't have the selected farm — showing zero
      // fields everywhere with the dropdown hidden would be unrecoverable.
      setSelectedFarmState(null);
      return;
    }
    if (
      selectedFarm === null &&
      localStorage.getItem(STORAGE_KEY) === null &&
      availableFarms.includes(DEFAULT_FARM)
    ) {
      setSelectedFarmState(DEFAULT_FARM);
    }
  }, [hydrated, availableFarms, selectedFarm]);

  const setSelectedFarm = useCallback((farm: string | null) => {
    setSelectedFarmState(farm);
    localStorage.setItem(STORAGE_KEY, farm ?? "");
  }, []);

  return (
    <ClientFilterContext.Provider
      value={{
        selectedFarm,
        setSelectedFarm,
        availableFarms,
        setAvailableFarms,
      }}
    >
      {children}
    </ClientFilterContext.Provider>
  );
}

export function useClientFilter() {
  const context = useContext(ClientFilterContext);
  if (context === undefined) {
    throw new Error("useClientFilter must be used within a ClientFilterProvider");
  }
  return context;
}
