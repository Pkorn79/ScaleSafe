-- 036: Add packet_pdf_path column to enrollments table.
-- Stores the Supabase Storage path of the generated enrollment packet PDF.

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS packet_pdf_path TEXT;
