'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface ClientFilterContextType {
  selectedClient: string | null;
  setSelectedClient: (client: string | null) => void;
  availableClients: string[];
  setAvailableClients: (clients: string[]) => void;
}

const ClientFilterContext = createContext<ClientFilterContextType | undefined>(undefined);

const STORAGE_KEY = 'ops-center-client-filter';

export function ClientFilterProvider({ children }: { children: ReactNode }) {
  const [selectedClient, setSelectedClientState] = useState<string | null>(null);
  const [availableClients, setAvailableClients] = useState<string[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setSelectedClientState(stored);
  }, []);

  const setSelectedClient = useCallback((client: string | null) => {
    setSelectedClientState(client);
    if (client) {
      localStorage.setItem(STORAGE_KEY, client);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return (
    <ClientFilterContext.Provider value={{
      selectedClient,
      setSelectedClient,
      availableClients,
      setAvailableClients,
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
