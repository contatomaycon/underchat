-- A cross-provider handoff may return to WWebJS after the immediately
-- preceding provider has preserved the exact same canonical app-state. The
-- runtime RLS scope intentionally hides historical WWebJS anchors, so expose
-- only the newest profile that is proven reusable for the current fenced
-- target revision. This avoids a second WhatsApp Web full-sync while keeping
-- arbitrary historical profiles and blobs inaccessible to the runtime role.

CREATE OR REPLACE FUNCTION public.resolve_whatsapp_wwebjs_reusable_handoff_profile_v1(
  p_session_id uuid,
  p_target_revision_id bigint,
  p_app_state_checksum_sha256 text,
  p_web_version text DEFAULT NULL
)
RETURNS TABLE (
  session_id uuid,
  revision_id bigint,
  anchor_generation bigint,
  artifact_id uuid,
  state text,
  checkpoint_mode text,
  artifact_checksum_sha256 text,
  artifact_size_bytes bigint,
  artifact_chunk_count integer,
  artifact_persisted_at timestamptz,
  artifact_verified_at timestamptz,
  baseline_app_state_checksum_sha256 text,
  current_app_state_checksum_sha256 text,
  app_state_overlay_required boolean,
  canonical_generation bigint,
  canonical_checksum_sha256 text,
  canonical_record_count integer,
  canonical_size_bytes bigint,
  canonical_persisted_at timestamptz,
  source text,
  last_profile_observed_size_bytes bigint,
  manifest jsonb,
  checksum_sha256 text,
  size_bytes bigint,
  chunk_count integer,
  status text,
  created_at timestamptz,
  persisted_at timestamptz,
  revision_source text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT anchor.session_id,
         anchor.revision_id,
         anchor.anchor_generation,
         anchor.artifact_id,
         anchor.state::text,
         anchor.checkpoint_mode::text,
         anchor.artifact_checksum_sha256::text,
         anchor.artifact_size_bytes,
         anchor.artifact_chunk_count,
         anchor.artifact_persisted_at,
         anchor.artifact_verified_at,
         anchor.baseline_app_state_checksum_sha256::text,
         anchor.current_app_state_checksum_sha256::text,
         anchor.app_state_overlay_required,
         anchor.canonical_generation,
         anchor.canonical_checksum_sha256::text,
         anchor.canonical_record_count,
         anchor.canonical_size_bytes,
         anchor.canonical_persisted_at,
         anchor.source::text,
         anchor.last_profile_observed_size_bytes,
         artifact.manifest,
         artifact.checksum_sha256::text,
         artifact.size_bytes,
         artifact.chunk_count,
         artifact.status::text,
         artifact.created_at,
         artifact.persisted_at,
         anchor_revision.source::text
  FROM public.whatsapp_session_handoff AS handoff
  JOIN public.whatsapp_session AS session
    ON session.session_id = handoff.session_id
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
  JOIN public.whatsapp_device AS target_device
    ON target_device.session_id = target_revision.session_id
   AND target_device.revision_id = target_revision.revision_id
  JOIN public.whatsapp_wwebjs_profile_anchor AS anchor
    ON anchor.session_id = handoff.session_id
   AND anchor.revision_id <> target_revision.revision_id
  JOIN public.whatsapp_session_revision AS anchor_revision
    ON anchor_revision.session_id = anchor.session_id
   AND anchor_revision.revision_id = anchor.revision_id
  JOIN public.whatsapp_device AS anchor_device
    ON anchor_device.session_id = anchor.session_id
   AND anchor_device.revision_id = anchor.revision_id
  JOIN public.whatsapp_artifact AS artifact
    ON artifact.session_id = anchor.session_id
   AND artifact.revision_id = anchor.revision_id
   AND artifact.artifact_id = anchor.artifact_id
  WHERE p_session_id IS NOT NULL
    AND p_target_revision_id IS NOT NULL
    AND p_app_state_checksum_sha256 ~ '^[0-9a-f]{64}$'
    AND (p_web_version IS NULL OR length(p_web_version) BETWEEN 1 AND 100)
    AND p_session_id = nullif(
      current_setting('app.whatsapp_session_id', true), ''
    )::uuid
    AND p_target_revision_id = nullif(
      current_setting('app.whatsapp_revision_id', true), ''
    )::bigint
    AND nullif(current_setting('app.whatsapp_operation_abi', true), '') =
      'profile-anchor-canonical-checkpoint-v1'
    AND public.whatsapp_runtime_scope_is_valid()
    AND handoff.session_id = p_session_id
    AND handoff.target_revision_id = p_target_revision_id
    AND handoff.target_provider = 'wwebjs'
    AND handoff.source_provider <> 'wwebjs'
    AND handoff.state IN (
      'draining', 'transforming', 'hydrating', 'validating',
      'promoting', 'activating'
    )
    AND target_revision.provider = 'wwebjs'
    AND target_revision.source = 'handoff'
    AND target_revision.status IN ('staging', 'validating', 'active')
    AND (
      (
        session.state = 'handoff'
        AND session.active_revision_id = handoff.source_revision_id
        AND target_revision.status IN ('staging', 'validating')
      )
      OR (
        session.state = 'preparing'
        AND session.active_revision_id = handoff.target_revision_id
        AND session.previous_revision_id = handoff.source_revision_id
        AND handoff.state = 'activating'
        AND target_revision.status = 'active'
      )
    )
    AND anchor_revision.provider = 'wwebjs'
    AND anchor_revision.status = 'retired'
    AND anchor.state = 'active'
    AND anchor.app_state_overlay_required = false
    AND anchor.current_app_state_checksum_sha256 =
      p_app_state_checksum_sha256
    AND anchor.baseline_app_state_checksum_sha256 =
      p_app_state_checksum_sha256
    AND anchor_device.fingerprint_version = target_device.fingerprint_version
    AND anchor_device.device_fingerprint = target_device.device_fingerprint
    AND artifact.provider = 'wwebjs'
    AND artifact.kind = 'wwebjs_profile'
    AND artifact.status = 'ready'
    AND (p_web_version IS NULL OR artifact.manifest->>'web_version' = p_web_version)
    AND EXISTS (
      SELECT 1
      FROM public.whatsapp_artifact AS gate
      WHERE gate.session_id = handoff.session_id
        AND gate.revision_id = handoff.target_revision_id
        AND gate.provider = 'wwebjs'
        AND gate.kind = 'app_state_snapshot_resync_gate'
        AND gate.status = 'ready'
        AND gate.manifest->>'handoff_id' = handoff.handoff_id::text
        AND gate.manifest->>'source_revision_id' =
          handoff.source_revision_id::text
        AND gate.manifest->>'target_revision_id' =
          handoff.target_revision_id::text
        AND gate.manifest->>'app_state_snapshot_resync_required' = 'false'
        AND gate.manifest->'app_state_snapshot_resync_collections' =
          '[]'::jsonb
    )
    AND NOT EXISTS (
      (
        SELECT key_id, key_data, "timestamp", fingerprint
        FROM public.whatsapp_app_state_sync_keys
        WHERE session_id = anchor.session_id
          AND revision_id = anchor.revision_id
        EXCEPT
        SELECT key_id, key_data, "timestamp", fingerprint
        FROM public.whatsapp_app_state_sync_keys
        WHERE session_id = target_revision.session_id
          AND revision_id = target_revision.revision_id
      )
      UNION ALL
      (
        SELECT key_id, key_data, "timestamp", fingerprint
        FROM public.whatsapp_app_state_sync_keys
        WHERE session_id = target_revision.session_id
          AND revision_id = target_revision.revision_id
        EXCEPT
        SELECT key_id, key_data, "timestamp", fingerprint
        FROM public.whatsapp_app_state_sync_keys
        WHERE session_id = anchor.session_id
          AND revision_id = anchor.revision_id
      )
    )
    AND NOT EXISTS (
      (
        SELECT name, version, hash
        FROM public.whatsapp_app_state_version
        WHERE session_id = anchor.session_id
          AND revision_id = anchor.revision_id
        EXCEPT
        SELECT name, version, hash
        FROM public.whatsapp_app_state_version
        WHERE session_id = target_revision.session_id
          AND revision_id = target_revision.revision_id
      )
      UNION ALL
      (
        SELECT name, version, hash
        FROM public.whatsapp_app_state_version
        WHERE session_id = target_revision.session_id
          AND revision_id = target_revision.revision_id
        EXCEPT
        SELECT name, version, hash
        FROM public.whatsapp_app_state_version
        WHERE session_id = anchor.session_id
          AND revision_id = anchor.revision_id
      )
    )
    AND NOT EXISTS (
      (
        SELECT name, version, index_mac, value_mac
        FROM public.whatsapp_app_state_mutation_macs
        WHERE session_id = anchor.session_id
          AND revision_id = anchor.revision_id
        EXCEPT
        SELECT name, version, index_mac, value_mac
        FROM public.whatsapp_app_state_mutation_macs
        WHERE session_id = target_revision.session_id
          AND revision_id = target_revision.revision_id
      )
      UNION ALL
      (
        SELECT name, version, index_mac, value_mac
        FROM public.whatsapp_app_state_mutation_macs
        WHERE session_id = target_revision.session_id
          AND revision_id = target_revision.revision_id
        EXCEPT
        SELECT name, version, index_mac, value_mac
        FROM public.whatsapp_app_state_mutation_macs
        WHERE session_id = anchor.session_id
          AND revision_id = anchor.revision_id
      )
    )
  ORDER BY anchor.updated_at DESC, anchor.revision_id DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.resolve_whatsapp_wwebjs_reusable_handoff_profile_v1(
  uuid, bigint, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_whatsapp_wwebjs_reusable_handoff_profile_v1(
  uuid, bigint, text, text
) TO whatsapp_session_runtime;

CREATE OR REPLACE FUNCTION public.read_whatsapp_wwebjs_reusable_handoff_profile_blobs_v1(
  p_session_id uuid,
  p_target_revision_id bigint,
  p_source_revision_id bigint,
  p_artifact_id uuid,
  p_app_state_checksum_sha256 text,
  p_web_version text,
  p_checksums text[]
)
RETURNS TABLE (
  sha256 text,
  payload bytea
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH reusable AS MATERIALIZED (
    SELECT resolved.revision_id, resolved.artifact_id
    FROM public.resolve_whatsapp_wwebjs_reusable_handoff_profile_v1(
      p_session_id,
      p_target_revision_id,
      p_app_state_checksum_sha256,
      p_web_version
    ) AS resolved
    WHERE resolved.revision_id = p_source_revision_id
      AND resolved.artifact_id = p_artifact_id
  )
  SELECT DISTINCT blob.sha256::text, blob.payload
  FROM reusable
  JOIN public.whatsapp_artifact_chunk AS chunk
    ON chunk.session_id = p_session_id
   AND chunk.artifact_id = reusable.artifact_id
  JOIN public.whatsapp_artifact_blob AS blob
    ON blob.session_id = chunk.session_id
   AND blob.sha256 = chunk.sha256
  WHERE cardinality(p_checksums) BETWEEN 1 AND 128
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_checksums) AS requested(checksum)
      WHERE requested.checksum !~ '^[0-9a-f]{64}$'
    )
    AND blob.sha256 = ANY(p_checksums);
$function$;

REVOKE ALL ON FUNCTION public.read_whatsapp_wwebjs_reusable_handoff_profile_blobs_v1(
  uuid, bigint, bigint, uuid, text, text, text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.read_whatsapp_wwebjs_reusable_handoff_profile_blobs_v1(
  uuid, bigint, bigint, uuid, text, text, text[]
) TO whatsapp_session_runtime;

COMMENT ON FUNCTION public.resolve_whatsapp_wwebjs_reusable_handoff_profile_v1(
  uuid, bigint, text, text
) IS 'Resolves one identity-, app-state-, lease- and handoff-fenced historical WWebJS profile for the current target revision.';

COMMENT ON FUNCTION public.read_whatsapp_wwebjs_reusable_handoff_profile_blobs_v1(
  uuid, bigint, bigint, uuid, text, text, text[]
) IS 'Reads only requested blobs belonging to the currently authorized reusable WWebJS handoff profile.';
