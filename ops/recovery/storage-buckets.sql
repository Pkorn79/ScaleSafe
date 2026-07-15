SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'public', public,
      'file_size_limit', file_size_limit,
      'allowed_mime_types', allowed_mime_types
    ) ORDER BY id
  ),
  '[]'::jsonb
)
FROM storage.buckets;
