-- ============================================================
-- PDF Max — Supabase Storage Setup
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Create the storage bucket for project files
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-files', 'project-files', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to upload files
CREATE POLICY "public upload files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-files');

-- Allow anyone to read/download files
CREATE POLICY "public read files"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-files');

-- Allow anyone to delete files
CREATE POLICY "public delete files"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-files');
