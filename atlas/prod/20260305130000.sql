-- Migrate legacy attendance_hours config payload from "days" to "rules"
WITH legacy_configs AS (
  SELECT
    wc.worker_config_id,
    wc.value::jsonb AS config_json
  FROM "worker_config" wc
  WHERE wc.worker_config_type_id = '019c923a-00fd-7490-9495-e9e72b652713'::uuid
    AND wc.value IS NOT NULL
    AND wc.value <> ''
    AND wc.value::jsonb ? 'days'
),
normalized_configs AS (
  SELECT
    lc.worker_config_id,
    jsonb_build_object(
      'timezone',
      COALESCE(
        NULLIF(BTRIM(lc.config_json->>'timezone'), ''),
        'America/Sao_Paulo'
      ),
      'outside_hours_action',
      CASE
        WHEN lc.config_json->>'outside_hours_action' IN ('continue_flow', 'message_only')
          THEN lc.config_json->>'outside_hours_action'
        ELSE 'message_only'
      END,
      'message_only_destination_status',
      CASE
        WHEN lc.config_json->>'message_only_destination_status' IN ('queue', 'closed')
          THEN lc.config_json->>'message_only_destination_status'
        ELSE 'queue'
      END,
      'message_only_queue_sector_id',
      CASE
        WHEN jsonb_typeof(lc.config_json->'message_only_queue_sector_id') = 'string'
          AND BTRIM(lc.config_json->>'message_only_queue_sector_id') <> ''
          THEN BTRIM(lc.config_json->>'message_only_queue_sector_id')
        ELSE NULL
      END,
      'rules',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'weekday', day_rules.weekday,
            'start_time', day_rules.start_time,
            'end_time', day_rules.end_time
          )
          ORDER BY day_rules.weekday_order, day_rules.start_time, day_rules.end_time
        )
        FROM (
          SELECT
            day.key AS weekday,
            CASE day.key
              WHEN 'monday' THEN 1
              WHEN 'tuesday' THEN 2
              WHEN 'wednesday' THEN 3
              WHEN 'thursday' THEN 4
              WHEN 'friday' THEN 5
              WHEN 'saturday' THEN 6
              WHEN 'sunday' THEN 7
              ELSE 999
            END AS weekday_order,
            BTRIM(day.value->>'start_time') AS start_time,
            BTRIM(day.value->>'end_time') AS end_time
          FROM jsonb_each(COALESCE(lc.config_json->'days', '{}'::jsonb)) AS day(key, value)
          WHERE day.key IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
            AND LOWER(COALESCE(day.value->>'enabled', 'false')) IN ('true', 't', '1')
            AND BTRIM(COALESCE(day.value->>'start_time', '')) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            AND BTRIM(COALESCE(day.value->>'end_time', '')) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            AND BTRIM(day.value->>'start_time') < BTRIM(day.value->>'end_time')
        ) AS day_rules
      ), '[]'::jsonb)
    ) AS config_json
  FROM legacy_configs lc
)
UPDATE "worker_config" wc
SET
  value = normalized_configs.config_json::text,
  updated_at = now()
FROM normalized_configs
WHERE wc.worker_config_id = normalized_configs.worker_config_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "worker_config" wc
    WHERE wc.worker_config_type_id = '019c923a-00fd-7490-9495-e9e72b652713'::uuid
      AND wc.value IS NOT NULL
      AND wc.value <> ''
      AND wc.value::jsonb ? 'days'
  ) THEN
    RAISE EXCEPTION 'Legacy attendance_hours format with "days" still exists after migration.';
  END IF;
END $$;
