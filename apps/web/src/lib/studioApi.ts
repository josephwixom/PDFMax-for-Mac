/**
 * Studio API — CRUD operations for Projects, Files, Sessions, Markups.
 * All functions return null/[] gracefully when Supabase is not configured.
 */
import { getSupabase } from './supabase';
import type { Project, ProjectFile, Session, SessionMarkup, MarkupStatus } from '@pdfmax/shared';

// ─── Projects ──────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb.from('projects').select('*').order('created_at', { ascending: false });
    return (data as Project[]) ?? [];
}

export async function createProject(name: string, description: string, owner_id: string): Promise<Project | null> {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('projects').insert({ name, description, owner_id }).select().single();
    if (error) { console.error('[Studio] createProject', error); return null; }
    return data as Project;
}

export async function deleteProject(id: string): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from('projects').delete().eq('id', id);
}

// ─── Project Files ──────────────────────────────────────────────────────────

export async function listFiles(projectId: string): Promise<ProjectFile[]> {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb.from('project_files').select('*').eq('project_id', projectId).order('uploaded_at', { ascending: false });
    return (data as ProjectFile[]) ?? [];
}

export async function uploadFile(projectId: string, file: File, uploadedBy: string): Promise<ProjectFile | null> {
    const sb = getSupabase();
    if (!sb) return null;
    const path = `${projectId}/${Date.now()}_${file.name}`;
    const { error: storageError } = await sb.storage.from('project-files').upload(path, file);
    if (storageError) { console.error('[Studio] upload', storageError); return null; }
    const { data, error } = await sb.from('project_files').insert({
        project_id: projectId,
        name: file.name,
        storage_path: path,
        version: 1,
        uploaded_by: uploadedBy,
    }).select().single();
    if (error) { console.error('[Studio] insertFile', error); return null; }
    return data as ProjectFile;
}

export async function getFileUrl(storagePath: string): Promise<string | null> {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = sb.storage.from('project-files').getPublicUrl(storagePath);
    return data?.publicUrl ?? null;
}

export async function deleteFile(file: ProjectFile): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    await sb.storage.from('project-files').remove([file.storage_path]);
    await sb.from('project_files').delete().eq('id', file.id);
}

// ─── Sessions ──────────────────────────────────────────────────────────────

export async function listSessions(fileId: string): Promise<Session[]> {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb.from('sessions').select('*').eq('file_id', fileId).order('created_at', { ascending: false });
    return (data as Session[]) ?? [];
}

export async function createSession(fileId: string, name: string, createdBy: string): Promise<Session | null> {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('sessions').insert({ file_id: fileId, name, created_by: createdBy, status: 'open' }).select().single();
    if (error) { console.error('[Studio] createSession', error); return null; }
    return data as Session;
}

export async function closeSession(sessionId: string): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from('sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', sessionId);
}

// ─── Session Markups ────────────────────────────────────────────────────────

export async function listSessionMarkups(sessionId: string): Promise<SessionMarkup[]> {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb.from('session_markups').select('*').eq('session_id', sessionId).order('created_at');
    return (data as SessionMarkup[]) ?? [];
}

export async function upsertMarkup(markup: Omit<SessionMarkup, 'created_at' | 'updated_at'>): Promise<SessionMarkup | null> {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('session_markups').upsert({
        ...markup,
        updated_at: new Date().toISOString(),
    }).select().single();
    if (error) { console.error('[Studio] upsertMarkup', error); return null; }
    return data as SessionMarkup;
}

export async function updateMarkupStatus(markupId: string, status: MarkupStatus): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from('session_markups').update({ status, updated_at: new Date().toISOString() }).eq('id', markupId);
}

export async function deleteSessionMarkup(markupId: string): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from('session_markups').delete().eq('id', markupId);
}
