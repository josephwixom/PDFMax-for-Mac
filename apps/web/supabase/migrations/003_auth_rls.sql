-- ============================================================
-- PDF Max — Auth RLS Policies
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- This tightens security so users can only access their own data.
-- ============================================================

-- Enable RLS on studio tables (may already be enabled)
ALTER TABLE IF EXISTS projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS review_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS session_markups ENABLE ROW LEVEL SECURITY;

-- Drop any existing public policies first
DROP POLICY IF EXISTS "public all" ON projects;
DROP POLICY IF EXISTS "public all" ON project_files;
DROP POLICY IF EXISTS "public all" ON review_sessions;
DROP POLICY IF EXISTS "public all" ON session_markups;

-- Projects: users see only their own projects
CREATE POLICY "owner can manage projects"
ON projects FOR ALL
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

-- Project files: visible to project owner
CREATE POLICY "owner can manage project files"
ON project_files FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM projects
        WHERE projects.id = project_files.project_id
        AND projects.owner_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM projects
        WHERE projects.id = project_files.project_id
        AND projects.owner_id = auth.uid()
    )
);

-- Review sessions: visible to project owner
CREATE POLICY "owner can manage sessions"
ON review_sessions FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM projects
        WHERE projects.id = review_sessions.project_id
        AND projects.owner_id = auth.uid()
    )
);

-- Session markups: visible to all authenticated users (collaboration)
CREATE POLICY "authenticated users can view markups"
ON session_markups FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated users can insert markups"
ON session_markups FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Storage: require authentication for uploads/deletes (keep reads public)
DROP POLICY IF EXISTS "public upload files" ON storage.objects;
DROP POLICY IF EXISTS "public delete files" ON storage.objects;

CREATE POLICY "authenticated upload files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-files' AND auth.role() = 'authenticated');

CREATE POLICY "authenticated delete files"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-files' AND auth.role() = 'authenticated');
