'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { JohnDeereConnection } from '@/types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  johnDeereConnection: JohnDeereConnection | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshJohnDeereConnection: () => Promise<void>;
  updatePreferredAreaUnit: (unit: string) => Promise<void>;
  updateHiddenCrops: (cropNames: string[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [johnDeereConnection, setJohnDeereConnection] = useState<JohnDeereConnection | null>(null);

  const fetchJohnDeereConnection = async (userId: string) => {
    const { data } = await supabase
      .from('john_deere_connections')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    setJohnDeereConnection(data);
  };

  const refreshJohnDeereConnection = async () => {
    if (user) {
      await fetchJohnDeereConnection(user.id);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchJohnDeereConnection(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchJohnDeereConnection(session.user.id);
      } else {
        setJohnDeereConnection(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error as Error | null };
  };

  const updatePreferredAreaUnit = async (unit: string) => {
    if (!user) return;
    await supabase
      .from('john_deere_connections')
      .update({ preferred_area_unit: unit, updated_at: new Date().toISOString() } as never)
      .eq('user_id', user.id);
    setJohnDeereConnection((prev) => prev ? { ...prev, preferred_area_unit: unit } : prev);
  };

  const updateHiddenCrops = async (cropNames: string[]) => {
    if (!user) return;
    await supabase
      .from('john_deere_connections')
      .update({ hidden_crop_names: cropNames, updated_at: new Date().toISOString() } as never)
      .eq('user_id', user.id);
    setJohnDeereConnection((prev) => prev ? { ...prev, hidden_crop_names: cropNames } : prev);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setJohnDeereConnection(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      johnDeereConnection,
      signIn,
      signUp,
      signOut,
      refreshJohnDeereConnection,
      updatePreferredAreaUnit,
      updateHiddenCrops,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
