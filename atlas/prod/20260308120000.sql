-- Add ai_agent_id column to worker_config table
ALTER TABLE worker_config ADD COLUMN ai_agent_id uuid REFERENCES ai_agent(ai_agent_id);
CREATE INDEX IF NOT EXISTS worker_config_ai_agent_id_idx ON worker_config(ai_agent_id);
CREATE INDEX IF NOT EXISTS worker_config_worker_id_ai_agent_id_idx ON worker_config(worker_id, ai_agent_id);

-- Insert new worker_config_type for ai_agent_id
INSERT INTO worker_config_type (worker_config_type_id, type, created_at, updated_at)
VALUES ('019ccf67-633d-7478-8aca-11720066346b', 'ai_agent_id', NOW(), NOW())
ON CONFLICT DO NOTHING;
