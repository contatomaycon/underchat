-- Modify "chatbot" table
ALTER TABLE "chatbot" ADD COLUMN "type" character varying(20) NULL DEFAULT 'input';
