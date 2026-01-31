ALTER TABLE ai_agent ADD COLUMN openai_assistant_id VARCHAR(200);
ALTER TABLE ai_agent ADD COLUMN openai_vector_store_id VARCHAR(200);
ALTER TABLE ai_agent_prompt ADD COLUMN openai_file_id VARCHAR(200);
