-- Association rows represent sets. Remove historical duplicates before
-- enforcing the invariant used by concurrent webhook-producing mutations.
WITH ranked AS (
  SELECT
    contact_label_template_id,
    ROW_NUMBER() OVER (
      PARTITION BY contact_id, label_template_id
      ORDER BY created_at NULLS LAST, contact_label_template_id
    ) AS row_number
  FROM contact_label_template
)
DELETE FROM contact_label_template AS assignment
USING ranked
WHERE assignment.contact_label_template_id = ranked.contact_label_template_id
  AND ranked.row_number > 1;

WITH ranked AS (
  SELECT
    contact_group_assignment_id,
    ROW_NUMBER() OVER (
      PARTITION BY contact_id, contact_group_id
      ORDER BY created_at NULLS LAST, contact_group_assignment_id
    ) AS row_number
  FROM contact_group_assignment
)
DELETE FROM contact_group_assignment AS assignment
USING ranked
WHERE assignment.contact_group_assignment_id = ranked.contact_group_assignment_id
  AND ranked.row_number > 1;

WITH ranked AS (
  SELECT
    contact_channel_id,
    ROW_NUMBER() OVER (
      PARTITION BY contact_id, channel_id
      ORDER BY created_at NULLS LAST, contact_channel_id
    ) AS row_number
  FROM contact_channel
)
DELETE FROM contact_channel AS assignment
USING ranked
WHERE assignment.contact_channel_id = ranked.contact_channel_id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS
  contact_label_template_contact_label_uidx
  ON contact_label_template (contact_id, label_template_id);

CREATE UNIQUE INDEX IF NOT EXISTS
  contact_group_assignment_contact_group_uidx
  ON contact_group_assignment (contact_id, contact_group_id);

CREATE UNIQUE INDEX IF NOT EXISTS
  contact_channel_contact_channel_uidx
  ON contact_channel (contact_id, channel_id);
