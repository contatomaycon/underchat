-- Keep the revision opened by the lifecycle function visible to the exact
-- leased runtime for the remainder of the caller transaction. The v17 FORCE
-- RLS policies require a database-signed scope; setting only session/revision
-- (the former implementation) made the immediate loadRevisionContext SELECT
-- return no rows and rolled a fresh pairing revision back.
CREATE OR REPLACE FUNCTION public.open_whatsapp_session_revision(
  p_session_id uuid,
  p_owner_id uuid,
  p_provider text,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text,
  p_source text DEFAULT 'pairing',
  p_schema_version integer DEFAULT 17,
  p_codec_version integer DEFAULT 1,
  p_format text DEFAULT 'whatsapp-canonical-v1'
)
RETURNS TABLE(revision_id bigint, status text, handoff_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_revision_id bigint;
  v_status text;
  v_handoff_id uuid;
  v_provider text;
BEGIN
  IF p_schema_version <> 17 THEN
    RAISE EXCEPTION 'unsupported whatsapp shared schema version %', p_schema_version
      USING ERRCODE = '0A000';
  END IF;

  v_provider := lower(trim(p_provider));

  SELECT opened.revision_id, opened.status, opened.handoff_id
  INTO v_revision_id, v_status, v_handoff_id
  FROM public.open_whatsapp_session_revision_schema16(
    p_session_id, p_owner_id, v_provider, p_fencing_token, p_generation,
    p_epoch, p_capability, p_source, p_schema_version, p_codec_version,
    p_format
  ) AS opened;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session revision is unavailable after open'
      USING ERRCODE = '55000';
  END IF;

  -- The inner lifecycle function has already validated and locked the exact
  -- lease/session/revision tuple. Mint the signed, transaction-local RLS scope
  -- without another query or lock acquisition.
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  PERFORM set_config('app.whatsapp_revision_id', v_revision_id::text, true);
  PERFORM set_config('app.whatsapp_owner_id', p_owner_id::text, true);
  PERFORM set_config('app.whatsapp_fencing_token', p_fencing_token::text, true);
  PERFORM set_config('app.whatsapp_generation', p_generation::text, true);
  PERFORM set_config('app.whatsapp_epoch', p_epoch::text, true);
  PERFORM set_config('app.whatsapp_capability', p_capability, true);
  PERFORM set_config('app.whatsapp_lease_provider', v_provider, true);
  PERFORM set_config('app.whatsapp_provider', v_provider, true);
  PERFORM public.issue_whatsapp_runtime_scope_signature();

  RETURN QUERY SELECT v_revision_id, v_status, v_handoff_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) TO whatsapp_session_runtime;

COMMENT ON FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) IS
  'Opens the exact provider revision and installs its capability/fencing-signed transaction-local FORCE RLS scope.';
