ALTER TABLE contact ADD COLUMN user_id uuid REFERENCES "user"(user_id);
CREATE INDEX contact_user_id_idx ON contact(user_id);
