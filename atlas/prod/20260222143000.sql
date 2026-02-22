INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  ('019c863c-d265-710f-bd69-f26730c157c2'::uuid, 'proxy_enabled'),
  ('019c863c-d267-754f-93a0-020245b3f973'::uuid, 'proxy_host'),
  ('019c863c-d267-754f-93a0-06cbbd3c7937'::uuid, 'proxy_port'),
  ('019c863c-d267-754f-93a0-09c55215f362'::uuid, 'proxy_username'),
  ('019c863c-d267-754f-93a0-0c5455ea887a'::uuid, 'proxy_password')
ON CONFLICT ("worker_config_type_id") DO NOTHING;
