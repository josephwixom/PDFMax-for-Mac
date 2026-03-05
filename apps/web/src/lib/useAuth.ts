'use client';
import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export interface AuthState {
    user: User | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<string | null>;
    signUp: (email: string, password: string) => Promise<string | null>;
    signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const sb = getSupabase();
        if (!sb) { setLoading(false); return; }

        // Get current session
        sb.auth.getSession().then(({ data }) => {
            setUser(data.session?.user ?? null);
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    const signIn = async (email: string, password: string): Promise<string | null> => {
        const sb = getSupabase();
        if (!sb) return 'Supabase not configured';
        const { error } = await sb.auth.signInWithPassword({ email, password });
        return error?.message ?? null;
    };

    const signUp = async (email: string, password: string): Promise<string | null> => {
        const sb = getSupabase();
        if (!sb) return 'Supabase not configured';
        const { error } = await sb.auth.signUp({ email, password });
        return error?.message ?? null;
    };

    const signOut = async () => {
        const sb = getSupabase();
        if (sb) await sb.auth.signOut();
    };

    return { user, loading, signIn, signUp, signOut };
}
