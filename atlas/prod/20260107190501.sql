-- Modify "ai_agent" table
ALTER TABLE "ai_agent" ADD COLUMN "model" character varying(100);
ALTER TABLE "ai_agent" ADD COLUMN "chunk_size" character varying(10) NOT NULL DEFAULT '600';
ALTER TABLE "ai_agent" ADD COLUMN "chunk_overlap" character varying(10) NOT NULL DEFAULT '100';
