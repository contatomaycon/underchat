INSERT INTO "worker_type" ("worker_type_id", "type")
VALUES ('e80ad183-2b46-4628-9105-a036f2d28720', 'whatsmeow')
ON CONFLICT ("worker_type_id") DO NOTHING;
