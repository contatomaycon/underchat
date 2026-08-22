-- The fingerprint-version continuity guard predates same-provider secure
-- imports from a pristine pairing draft. Such a draft deliberately has no
-- canonical companion fingerprint or fingerprint version, so NULL -> v2 is
-- the first identity assignment rather than a version change. The promotion
-- primitive remains responsible for proving that the source is pristine.
-- Fail closed when the source header already claims an identity, when the
-- source revision has a version, or when the new ready identity is not v2.
CREATE OR REPLACE FUNCTION public.guard_whatsapp_session_fingerprint_v17()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_device_fingerprint bytea;
  v_fingerprint_version text;
  v_previous_fingerprint_version text;
  v_identity_changed boolean;
BEGIN
  IF NEW.active_revision_id IS NULL OR NEW.active_device_fingerprint IS NULL THEN
    IF NEW.active_device_fingerprint IS NULL THEN
      NEW.active_device_fingerprint_version := NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT device.device_fingerprint, device.fingerprint_version
  INTO v_device_fingerprint, v_fingerprint_version
  FROM public.whatsapp_device AS device
  WHERE device.session_id = NEW.session_id
    AND device.revision_id = NEW.active_revision_id;

  IF NOT FOUND
    OR v_device_fingerprint IS DISTINCT FROM NEW.active_device_fingerprint
    OR v_fingerprint_version IS NULL
  THEN
    RAISE EXCEPTION 'active whatsapp companion fingerprint is not owned by its revision'
      USING ERRCODE = '23514';
  END IF;

  NEW.active_device_fingerprint_version := v_fingerprint_version;
  v_identity_changed := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    v_identity_changed :=
      NEW.active_revision_id IS DISTINCT FROM OLD.active_revision_id
      OR NEW.active_device_fingerprint IS DISTINCT FROM OLD.active_device_fingerprint
      OR NEW.state IS DISTINCT FROM OLD.state;

    IF OLD.active_revision_id IS NOT NULL
      AND NEW.active_revision_id IS DISTINCT FROM OLD.active_revision_id
      AND NEW.previous_revision_id IS NOT DISTINCT FROM OLD.active_revision_id
    THEN
      SELECT device.fingerprint_version
      INTO v_previous_fingerprint_version
      FROM public.whatsapp_device AS device
      WHERE device.session_id = NEW.session_id
        AND device.revision_id = OLD.active_revision_id;

      IF v_previous_fingerprint_version IS NULL THEN
        IF OLD.active_device_fingerprint IS NOT NULL
          OR OLD.active_device_fingerprint_version IS NOT NULL
        THEN
          RAISE EXCEPTION 'source whatsapp companion fingerprint version is missing'
            USING ERRCODE = '23514';
        END IF;
      ELSIF v_previous_fingerprint_version IS DISTINCT FROM v_fingerprint_version THEN
        RAISE EXCEPTION 'whatsapp handoff fingerprint versions differ'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF NEW.state = 'ready'
    AND v_identity_changed
    AND v_fingerprint_version <> 'underchat-whatsapp-device-fingerprint-v2'
  THEN
    RAISE EXCEPTION 'new ready whatsapp identity requires fingerprint v2'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_whatsapp_session_fingerprint_v17()
FROM PUBLIC;
