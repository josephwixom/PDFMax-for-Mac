'use client';

import { useEffect, useRef, useCallback } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useCollabStore } from '@/store/useCollabStore';
import { listSessionMarkups, upsertMarkup } from '@/lib/studioApi';
import type { SessionMarkup } from '@pdfmax/shared';

interface UseRealtimeSyncOptions {
    sessionId: string;
    onRemoteMarkup?: (markup: SessionMarkup) => void;
}

export function useRealtimeSync({ sessionId, onRemoteMarkup }: UseRealtimeSyncOptions) {
    const { reviewer, addSessionMarkup, setSessionMarkups, setPeers, setIsLive, setActiveSession } = useCollabStore();
    const channelRef = useRef<any>(null);

    // Load existing markups when joining a session
    useEffect(() => {
        if (!sessionId) return;
        listSessionMarkups(sessionId).then(markups => {
            setSessionMarkups(markups);
            onRemoteMarkup && markups.forEach(onRemoteMarkup);
        });
    }, [sessionId]);

    // Subscribe to Realtime changes
    useEffect(() => {
        const sb = getSupabase();
        if (!sb || !sessionId) return;

        const channel = sb.channel(`session:${sessionId}`, {
            config: { presence: { key: reviewer?.id ?? 'anon' } },
        });

        // Presence — track who is online
        channel.on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState<{ name: string; color: string; id: string }>();
            const peers = Object.values(state).flat().map((p: any) => ({
                id: p.id ?? 'unknown',
                name: p.name ?? 'Reviewer',
                color: p.color ?? '#6366f1',
            }));
            setPeers(peers.filter(p => p.id !== reviewer?.id));
        });

        // Markup changes (postgres realtime)
        channel.on(
            'postgres_changes' as any,
            { event: '*', schema: 'public', table: 'session_markups', filter: `session_id=eq.${sessionId}` },
            (payload: any) => {
                const m = (payload.new ?? payload.old) as SessionMarkup;
                if (!m) return;
                if (payload.eventType === 'DELETE') return;
                if (m.author_id === reviewer?.id) return; // skip own echoes
                addSessionMarkup(m);
                onRemoteMarkup?.(m);
            }
        );

        // Admin broadcast messages (kick, lock)
        channel.on('broadcast', { event: 'admin' }, (payload: any) => {
            const { type, targetId } = payload.payload ?? {};
            if (type === 'kick-peer' && targetId === reviewer?.id) {
                setActiveSession(null);
                window.dispatchEvent(new CustomEvent('pdfmax:toast', {
                    detail: { message: 'You were removed from this session by the host.', kind: 'warning' }
                }));
            } else if (type === 'session-locked') {
                window.dispatchEvent(new CustomEvent('pdfmax:session-locked'));
            } else if (type === 'session-unlocked') {
                window.dispatchEvent(new CustomEvent('pdfmax:session-unlocked'));
            }
        });

        channel.subscribe(async (status: string) => {
            if (status === 'SUBSCRIBED') {
                setIsLive(true);
                if (reviewer) {
                    await channel.track({ id: reviewer.id, name: reviewer.name, color: reviewer.color });
                }
            }
        });

        channelRef.current = channel;
        return () => {
            setIsLive(false);
            sb.removeChannel(channel);
        };
    }, [sessionId, reviewer?.id]);

    // Push a new local markup to Supabase
    const pushMarkup = useCallback(async (markupData: any, page: number) => {
        if (!reviewer || !sessionId) return null;
        const sm: Omit<SessionMarkup, 'created_at' | 'updated_at'> = {
            id: crypto.randomUUID(),
            session_id: sessionId,
            page_number: page,
            markup_data: markupData,
            author_id: reviewer.id,
            author_name: reviewer.name,
            author_color: reviewer.color,
            status: 'open',
        };
        const saved = await upsertMarkup(sm);
        if (saved) addSessionMarkup(saved);
        return saved;
    }, [sessionId, reviewer]);

    /** Send an admin broadcast (host only: kick, lock, unlock). */
    const broadcastAdmin = useCallback((type: string, targetId?: string) => {
        channelRef.current?.send({
            type: 'broadcast',
            event: 'admin',
            payload: { type, targetId },
        });
    }, []);

    return { pushMarkup, broadcastAdmin };
}
