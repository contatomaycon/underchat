-- A successful WWebJS activation protects its pre-activation profile until a
-- later coherent full-profile checkpoint can replace that rollback boundary.
-- v1 correctly refuses to rotate while any handoff still references the sole
-- `previous` anchor, but completed handoffs had no bounded release path. v2
-- releases only terminal, successful protection for the same WWebJS revision
-- and delegates the actual rotation to v1 in the same SQL statement. An error
-- in v1 therefore rolls the release back together with the candidate artifact.

CREATE OR REPLACE FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v2(
  p_session_id uuid,
  p_revision_id bigint,
  p_artifact_id uuid,
  p_expected_artifact_id uuid,
  p_expected_anchor_generation bigint,
  p_expected_canonical_generation bigint,
  p_checkpoint_mode text,
  p_canonical_checksum_sha256 text,
  p_canonical_record_count integer,
  p_canonical_size_bytes bigint,
  p_current_app_state_checksum_sha256 text,
  p_source text,
  p_last_profile_observed_size_bytes bigint
)
RETURNS TABLE (
  session_id uuid,
  revision_id bigint,
  state text,
  anchor_generation bigint,
  canonical_generation bigint,
  artifact_id uuid,
  artifact_checksum_sha256 text,
  artifact_size_bytes bigint,
  artifact_chunk_count integer,
  artifact_persisted_at timestamptz,
  artifact_verified_at timestamptz,
  baseline_app_state_checksum_sha256 text,
  current_app_state_checksum_sha256 text,
  app_state_overlay_required boolean,
  checkpoint_mode text,
  canonical_checksum_sha256 text,
  canonical_record_count integer,
  canonical_size_bytes bigint,
  canonical_persisted_at timestamptz,
  source text,
  last_profile_observed_size_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_previous_artifact_id uuid;
BEGIN
  IF p_session_id IS NULL
    OR p_revision_id IS NULL
    OR p_artifact_id IS NULL
    OR p_session_id IS DISTINCT FROM nullif(
         current_setting('app.whatsapp_session_id', true), ''
       )::uuid
    OR p_revision_id IS DISTINCT FROM nullif(
         current_setting('app.whatsapp_revision_id', true), ''
       )::bigint
    OR nullif(current_setting('app.whatsapp_operation_abi', true), '')
       IS DISTINCT FROM 'profile-anchor-canonical-checkpoint-v1'
    OR NOT public.whatsapp_runtime_scope_is_valid()
  THEN
    RAISE EXCEPTION 'stale or unauthorized WWebJS profile anchor checkpoint'
      USING ERRCODE = '55000';
  END IF;

  IF p_checkpoint_mode = 'full_profile_plus_fresh_canonical_v1'
    AND p_expected_artifact_id IS NOT NULL
    AND p_artifact_id IS DISTINCT FROM p_expected_artifact_id
  THEN
    -- Match v1's active-anchor CAS before changing historical protection. The
    -- row lock also serializes concurrent checkpoints on this revision.
    PERFORM 1
    FROM public.whatsapp_wwebjs_profile_anchor AS active_anchor
    WHERE active_anchor.session_id = p_session_id
      AND active_anchor.revision_id = p_revision_id
      AND active_anchor.state = 'active'
      AND active_anchor.artifact_id = p_expected_artifact_id
      AND active_anchor.anchor_generation = p_expected_anchor_generation
      AND active_anchor.canonical_generation =
          p_expected_canonical_generation
    FOR UPDATE OF active_anchor;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stale WWebJS profile anchor checkpoint CAS'
        USING ERRCODE = '55000';
    END IF;

    SELECT previous_anchor.artifact_id
    INTO v_previous_artifact_id
    FROM public.whatsapp_wwebjs_profile_anchor AS previous_anchor
    WHERE previous_anchor.session_id = p_session_id
      AND previous_anchor.revision_id = p_revision_id
      AND previous_anchor.state = 'previous'
    FOR UPDATE OF previous_anchor;

    IF v_previous_artifact_id IS NOT NULL THEN
      -- A pending/failed/recovering handoff, a different lineage or a source
      -- other than an already-finalized WWebJS activation remains protected.
      IF EXISTS (
        SELECT 1
        FROM public.whatsapp_session_handoff AS protected_handoff
        WHERE protected_handoff.session_id = p_session_id
          AND protected_handoff.pre_activation_artifact_id =
              v_previous_artifact_id
          AND NOT (
            protected_handoff.state = 'completed'
            AND protected_handoff.target_provider = 'wwebjs'
            AND protected_handoff.target_revision_id = p_revision_id
            AND protected_handoff.point_of_no_return_at IS NOT NULL
            AND protected_handoff.completed_at IS NOT NULL
            AND protected_handoff.recovery_state = 'none'
          )
      ) THEN
        RAISE EXCEPTION
          'wwebjs_profile_anchor_previous_protection_active'
          USING ERRCODE = '55000';
      END IF;

      UPDATE public.whatsapp_session_handoff AS completed_handoff
      SET pre_activation_artifact_id = NULL,
          updated_at = clock_timestamp()
      WHERE completed_handoff.session_id = p_session_id
        AND completed_handoff.pre_activation_artifact_id =
            v_previous_artifact_id
        AND completed_handoff.state = 'completed'
        AND completed_handoff.target_provider = 'wwebjs'
        AND completed_handoff.target_revision_id = p_revision_id
        AND completed_handoff.point_of_no_return_at IS NOT NULL
        AND completed_handoff.completed_at IS NOT NULL
        AND completed_handoff.recovery_state = 'none';
    END IF;
  END IF;

  RETURN QUERY
  SELECT committed.*
  FROM public.commit_wwebjs_profile_anchor_checkpoint_v1(
    p_session_id,
    p_revision_id,
    p_artifact_id,
    p_expected_artifact_id,
    p_expected_anchor_generation,
    p_expected_canonical_generation,
    p_checkpoint_mode,
    p_canonical_checksum_sha256,
    p_canonical_record_count,
    p_canonical_size_bytes,
    p_current_app_state_checksum_sha256,
    p_source,
    p_last_profile_observed_size_bytes
  ) AS committed;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v2(
  uuid, bigint, uuid, uuid, bigint, bigint, text, text, integer, bigint,
  text, text, bigint
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v2(
  uuid, bigint, uuid, uuid, bigint, bigint, text, text, integer, bigint,
  text, text, bigint
) TO whatsapp_session_runtime;

COMMENT ON FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v2(
  uuid, bigint, uuid, uuid, bigint, bigint, text, text, integer, bigint,
  text, text, bigint
) IS
  'Atomically releases only terminal WWebJS activation protection before delegating a coherent profile-anchor rotation to v1.';
