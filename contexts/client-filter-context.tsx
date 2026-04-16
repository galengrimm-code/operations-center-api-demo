'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface ClientFilterContextType {
  selectedFarm: string | null;
  setSelectedFarm: (farm: string | null) => void;
  availableFarms: string[];
  setAvailableFarms: (farms: string[]) => void;
}

const ClientFilterContext = createContext<ClientFilterContextType | undefined>(undefined);

const STORAGE_KEY = 'ops-center-farm-filter';

export function ClientFilterProvider({ children }: { children: ReactNode }) {
  const [selectedFarm, setSelectedFarmState] = useState<string | null>(null);
  const [availableFarms, setAvailableFarms] = useState<string[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setSelectedFarmState(stored);
  }, []);

  const setSelectedFarm = useCallback((farm: string | null) => {
    setSelectedFarmState(farm);
    if (farm) {
      localStorage.setItem(STORAGE_KEY, farm);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return (
    <ClientFilterContext.Provider value={{
      selectedFarm,
      setSelectedFarm,
      availableFarms,
      setAvailableFarms,
    }}>
      {children}
    </ClientFilterContext.Provider>
  );
}

export function useClientFilter() {
  const context = useContext(ClientFilterContext);
  if (context === undefined) {
    throw new Error('useClientFilter must be used within a ClientFilterProvider');
  }
  return context;
}
