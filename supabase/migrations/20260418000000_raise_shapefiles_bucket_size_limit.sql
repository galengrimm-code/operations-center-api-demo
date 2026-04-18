-- Raise the per-object size limit on the shapefiles bucket.
-- Some JD field operations produce shapefile ZIPs larger than the default
-- (typically 50MB), causing "The object exceeded the maximum allowed size"
-- errors during shapefile-status. 500MB handles dense harvest telemetry
-- across multi-hundred-acre fields.
--
-- NOTE: storage.buckets lives in Supabase's storage schema and is NOT
-- managed by this app's migrations. Apply this manually via the Supabase
-- SQL editor if the CLI doesn't have permission on storage.*.

UPDATE storage.buckets
SET file_size_limit = 524288000  -- 500MB
WHERE id = 'shapefiles';
