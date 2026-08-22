import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const migration = readFileSync(
  resolve(root, 'atlas/prod/20260809100000.sql'),
  'utf8'
);
const terminalProtectionRotationMigration = readFileSync(
  resolve(root, 'atlas/prod/20260814095500.sql'),
  'utf8'
);
const model = readFileSync(
  resolve(root, 'packages/models/worker/workerWhatsappSession.model.ts'),
  'utf8'
);

const currentAbi = 'profile-anchor-canonical-checkpoint-v1';
const commitSignature =
  'uuid, bigint, uuid, uuid, bigint, bigint, text, text, integer, bigint,\n' +
  '  text, text, bigint';

describe('WWebJS profile-anchor PostgreSQL migration', () => {
  it('is an additive v17 expand migration with lazy adoption', () => {
    expect(migration).not.toMatch(/\b(?:DROP TABLE|TRUNCATE)\b/u);
    expect(migration).not.toContain('UPDATE public.whatsapp_store_version');
    expect(migration).not.toContain(
      'INSERT INTO public.whatsapp_wwebjs_profile_anchor\nSELECT'
    );
    expect(migration).toMatch(/does\s*--\s*not backfill authority rows/u);
    expect(migration).toContain("'legacy_adoption_v1'");
  });

  it('binds every anchor generation to its exact revision artifact', () => {
    for (const source of [migration, model]) {
      expect(source).toContain('whatsapp_wwebjs_profile_anchor');
      expect(source).toContain('whatsapp_artifact_revision_artifact_uq');
      expect(source).toContain('whatsapp_wwebjs_profile_anchor_artifact_fk');
      expect(source).toContain('whatsapp_wwebjs_profile_anchor_active_uidx');
      expect(source).toContain('whatsapp_wwebjs_profile_anchor_previous_uidx');
      expect(source).toContain('whatsapp_wwebjs_profile_anchor_gc_idx');
      expect(source).toContain('whatsapp_artifact_wwebjs_ready_profile_uidx');
      expect(source).toContain(
        'whatsapp_artifact_wwebjs_retired_profile_gc_idx'
      );
    }
    expect(migration).toMatch(
      /FOREIGN KEY \(session_id, revision_id, artifact_id\)[\s\S]+ON DELETE CASCADE/u
    );
    expect(migration).toContain(
      "WHERE provider = 'wwebjs'\n  AND kind = 'wwebjs_profile'\n  AND status = 'ready'"
    );
    expect(model).toMatch(
      /whatsapp_wwebjs_profile_anchor_artifact_fk[\s\S]+onDelete\('cascade'\)/u
    );
  });

  it('stores canonical and app-state proof with a sticky overlay invariant', () => {
    for (const column of [
      'baseline_app_state_checksum_sha256',
      'current_app_state_checksum_sha256',
      'app_state_overlay_required',
      'canonical_generation',
      'canonical_checksum_sha256',
      'canonical_record_count',
      'canonical_size_bytes',
      'artifact_verified_at',
      'retain_until',
    ]) {
      expect(migration).toContain(column);
      expect(model).toContain(column);
    }
    expect(migration).toContain('canonical_record_count >= 0');
    expect(migration).toContain(
      'v_active.app_state_overlay_required\n      OR v_baseline_app_state_checksum_sha256 IS NULL'
    );
    expect(migration).toContain("retain_until = v_now + interval '24 hours'");
    expect(migration).toContain(
      'previous WWebJS profile anchor is still protected by a handoff'
    );
    expect(migration).toContain(
      'DELETE FROM public.whatsapp_artifact AS stale_artifact'
    );
    expect(migration).toContain(
      'retained_handoff.pre_activation_artifact_id ='
    );
    expect(migration).toContain(
      "legacy_marker.record_key = 'last_good_profile_anchor_v1'"
    );
  });

  it('publishes the exact CAS ABI and returns the complete authority proof', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v1('
    );
    expect(migration).toContain(
      `REVOKE ALL ON FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v1(\n  ${commitSignature}\n) FROM PUBLIC;`
    );
    expect(migration).toContain(
      `GRANT EXECUTE ON FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v1(\n  ${commitSignature}\n) TO whatsapp_session_runtime;`
    );
    for (const returned of [
      'session_id uuid',
      'revision_id bigint',
      'state text',
      'anchor_generation bigint',
      'canonical_generation bigint',
      'app_state_overlay_required boolean',
    ]) {
      expect(migration).toContain(returned);
    }
    expect(migration).toContain("USING ERRCODE = '55000'");
    expect(migration).toContain(
      "jsonb_typeof(v_canonical_metadata) IS DISTINCT FROM 'object'"
    );
    expect(migration).toContain(
      "(v_canonical_metadata ->> 'record_count')::integer\n         IS DISTINCT FROM p_canonical_record_count"
    );
    expect(migration).toContain(
      "(v_canonical_metadata ->> 'size_bytes')::bigint\n         IS DISTINCT FROM p_canonical_size_bytes"
    );
    expect(migration).toContain(
      'WHEN invalid_text_representation OR numeric_value_out_of_range THEN'
    );
  });

  it('rotates a protected previous anchor only after terminal WWebJS activation', () => {
    expect(terminalProtectionRotationMigration).toContain(
      'commit_wwebjs_profile_anchor_checkpoint_v2'
    );
    expect(terminalProtectionRotationMigration).toContain(
      "p_checkpoint_mode = 'full_profile_plus_fresh_canonical_v1'"
    );
    expect(terminalProtectionRotationMigration).toContain(
      "protected_handoff.state = 'completed'"
    );
    expect(terminalProtectionRotationMigration).toContain(
      "protected_handoff.target_provider = 'wwebjs'"
    );
    expect(terminalProtectionRotationMigration).toContain(
      'protected_handoff.target_revision_id = p_revision_id'
    );
    expect(terminalProtectionRotationMigration).toContain(
      "protected_handoff.recovery_state = 'none'"
    );
    expect(terminalProtectionRotationMigration).toContain(
      'protected_handoff.point_of_no_return_at IS NOT NULL'
    );
    expect(terminalProtectionRotationMigration).toContain(
      'protected_handoff.completed_at IS NOT NULL'
    );
    expect(terminalProtectionRotationMigration).toContain(
      'wwebjs_profile_anchor_previous_protection_active'
    );
    expect(terminalProtectionRotationMigration).toMatch(
      /UPDATE public\.whatsapp_session_handoff[\s\S]+SET pre_activation_artifact_id = NULL[\s\S]+commit_wwebjs_profile_anchor_checkpoint_v1/u
    );
    expect(terminalProtectionRotationMigration).toContain(
      ') TO whatsapp_session_runtime;'
    );
  });

  it('fences both legacy transaction boundaries after authority adoption', () => {
    for (const boundary of [
      'begin_whatsapp_session_operation',
      'begin_whatsapp_session_mutation',
    ]) {
      expect(migration).toContain(`${boundary}_v17_core`);
      expect(migration).toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${boundary}\\([\\s\\S]+p_operation_abi text[\\s\\S]+${currentAbi}`,
          'u'
        )
      );
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${boundary}(\n  uuid, bigint, uuid, bigint, integer, uuid, text, text\n) FROM PUBLIC;`
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${boundary}(\n  uuid, bigint, uuid, bigint, integer, uuid, text, text\n) TO whatsapp_session_runtime;`
      );
      const legacyWrapper = migration.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${boundary}\\([\\s\\S]+?p_capability text\\n\\)[\\s\\S]+?AS \\$function\\$([\\s\\S]+?)\\$function\\$;`,
          'u'
        )
      )?.[1];
      expect(legacyWrapper).toBeDefined();
      expect(legacyWrapper).toContain('IF EXISTS (');
      expect(legacyWrapper).not.toContain(
        "current_setting('app.whatsapp_operation_abi'"
      );
      expect(legacyWrapper).not.toContain("'legacy-v17'");
    }
    expect(migration).not.toMatch(/p_operation_abi text\s+DEFAULT/u);
    expect(migration).toContain("AND anchor.state = 'active'");
  });

  it('keeps the authority SELECT-only for the runtime role under signed RLS', () => {
    expect(migration).toContain(
      'ALTER TABLE public.whatsapp_wwebjs_profile_anchor FORCE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      'CREATE POLICY whatsapp_wwebjs_profile_anchor_runtime_select'
    );
    expect(migration).toContain(
      'AND (SELECT public.whatsapp_runtime_scope_is_valid())'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.whatsapp_wwebjs_profile_anchor\n  FROM whatsapp_session_runtime'
    );
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.whatsapp_wwebjs_profile_anchor\n  TO whatsapp_session_runtime'
    );
    expect(migration).not.toMatch(
      /GRANT (?:INSERT|UPDATE|DELETE)[\s\S]{0,120}whatsapp_wwebjs_profile_anchor/u
    );
  });

  it('keeps the typed row as the sole authority instead of duplicating it in JSON', () => {
    expect(migration).not.toContain('profile_canonical_authority_v2');
    expect(migration).not.toContain('cleanup_wwebjs_profile_anchor_marker_v2');
    expect(migration).toContain(
      "legacy_marker.record_key = 'last_good_profile_anchor_v1'"
    );
  });
});
