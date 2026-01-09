-- Remove is_automatic_attendance configuration type
-- Delete all worker_config entries that use is_automatic_attendance type
DELETE FROM "worker_config" 
WHERE "worker_config_type_id" = '019b89ac-697c-768e-a69a-e1cb80cde900'::uuid;

-- Delete the is_automatic_attendance type from worker_config_type table
DELETE FROM "worker_config_type" 
WHERE "worker_config_type_id" = '019b89ac-697c-768e-a69a-e1cb80cde900'::uuid;