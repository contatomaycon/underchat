-- Insert new worker config types for transfer protocol messages
INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES 
  ('019b89ac-697d-750c-b404-2a8f14dc5b4d'::uuid, 'generate_protocol_at_transfer_sector'),
  ('019b89ac-697d-750c-b404-2b9f25ed6c5e'::uuid, 'generate_protocol_at_transfer_sector_and_user')
ON CONFLICT ("worker_config_type_id") DO NOTHING;