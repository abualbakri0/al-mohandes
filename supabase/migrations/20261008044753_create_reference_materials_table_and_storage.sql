/*
# Create reference_materials table and storage bucket for PDF references

## Summary
Adds a "references" feature where the developer can upload PDF files and all users can browse and download them. Files are stored in Supabase Storage (bucket: `references`), and metadata lives in the `reference_materials` table.

## New Tables
- `reference_materials`
  - `id` (uuid, primary key)
  - `title` (text, not null) — display name of the reference
  - `description` (text, nullable) — optional description
  - `file_path` (text, not null) — storage path inside the `references` bucket
  - `file_size` (bigint, nullable) — file size in bytes for display
  - `department` (text, nullable) — department filter
  - `created_at` (timestamptz, default now())

## Storage
- Creates bucket `references` (public, 50MB file size limit, PDF only)
- Public read policy so anon users can download
- Open write/delete policy so developer can upload/delete via anon key

## Security
- RLS enabled on `reference_materials` table
- SELECT/INSERT/UPDATE/DELETE: `TO anon, authenticated` (no-auth app, data is intentionally shared)
- Storage bucket is public for reads, open for writes
*/

CREATE TABLE IF NOT EXISTS reference_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  file_path text NOT NULL,
  file_size bigint,
  department text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reference_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_reference_materials" ON reference_materials;
CREATE POLICY "anon_select_reference_materials"
ON reference_materials FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_reference_materials" ON reference_materials;
CREATE POLICY "anon_insert_reference_materials"
ON reference_materials FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_reference_materials" ON reference_materials;
CREATE POLICY "anon_update_reference_materials"
ON reference_materials FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_reference_materials" ON reference_materials;
CREATE POLICY "anon_delete_reference_materials"
ON reference_materials FOR DELETE
TO anon, authenticated USING (true);

-- Create storage bucket for references
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('references', 'references', true, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies: public read, anyone can upload/delete
DROP POLICY IF EXISTS "Public read references bucket" ON storage.objects;
CREATE POLICY "Public read references bucket"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'references');

DROP POLICY IF EXISTS "Anyone can upload references" ON storage.objects;
CREATE POLICY "Anyone can upload references"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'references');

DROP POLICY IF EXISTS "Anyone can delete references" ON storage.objects;
CREATE POLICY "Anyone can delete references"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'references');