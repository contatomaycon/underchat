import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260812210000.sql'),
  'utf8'
);

describe('WWebJS reusable handoff profile PostgreSQL migration', () => {
  it('is additive and exposes only capability-fenced read functions', () => {
    expect(migration).not.toMatch(
      /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/u
    );
    expect(migration.match(/SECURITY DEFINER/gu)).toHaveLength(2);
    expect(
      migration.match(/SET search_path TO 'pg_catalog', 'public'/gu)
    ).toHaveLength(2);
    const signatures = new Map([
      [
        'resolve_whatsapp_wwebjs_reusable_handoff_profile_v1',
        'uuid, bigint, text, text',
      ],
      [
        'read_whatsapp_wwebjs_reusable_handoff_profile_blobs_v1',
        'uuid, bigint, bigint, uuid, text, text, text[]',
      ],
    ]);
    for (const [name, signature] of signatures) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${name}(`);
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}(\n  ${signature}\n) TO whatsapp_session_runtime;`
      );
    }
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|ALL).*whatsapp_artifact/u);
  });

  it('binds the resolver to the signed runtime scope and current target', () => {
    expect(migration).toContain(
      "current_setting('app.whatsapp_session_id', true)"
    );
    expect(migration).toContain(
      "current_setting('app.whatsapp_revision_id', true)"
    );
    expect(migration).toContain(
      "current_setting('app.whatsapp_operation_abi', true)"
    );
    expect(migration).toContain("'profile-anchor-canonical-checkpoint-v1'");
    expect(migration).toContain('public.whatsapp_runtime_scope_is_valid()');
    expect(migration).toContain(
      'handoff.target_revision_id = p_target_revision_id'
    );
    expect(migration).toContain("handoff.target_provider = 'wwebjs'");
    expect(migration).toContain("handoff.source_provider <> 'wwebjs'");
    expect(migration).toContain("target_revision.source = 'handoff'");
  });

  it('permits only an exact coherent historical WWebJS authority', () => {
    expect(migration).toContain("anchor_revision.provider = 'wwebjs'");
    expect(migration).toContain("anchor_revision.status = 'retired'");
    expect(migration).toContain("anchor.state = 'active'");
    expect(migration).toContain('anchor.app_state_overlay_required = false');
    expect(migration).toContain(
      'anchor.current_app_state_checksum_sha256 =\n      p_app_state_checksum_sha256'
    );
    expect(migration).toContain(
      'anchor.baseline_app_state_checksum_sha256 =\n      p_app_state_checksum_sha256'
    );
    expect(migration).toContain(
      'anchor_device.device_fingerprint = target_device.device_fingerprint'
    );
    expect(migration).toContain("artifact.kind = 'wwebjs_profile'");
    expect(migration).toContain("artifact.status = 'ready'");
    expect(migration).toContain("gate.kind = 'app_state_snapshot_resync_gate'");
    expect(migration).toContain(
      "gate.manifest->>'app_state_snapshot_resync_required' = 'false'"
    );
    expect(migration).toContain(
      "gate.manifest->'app_state_snapshot_resync_collections' =\n          '[]'::jsonb"
    );
  });

  it('proves exact bidirectional equality for every app-state table', () => {
    for (const table of [
      'whatsapp_app_state_sync_keys',
      'whatsapp_app_state_version',
      'whatsapp_app_state_mutation_macs',
    ]) {
      const matches = migration.match(
        new RegExp(`FROM public\\.${table}`, 'gu')
      );
      expect(matches).toHaveLength(4);
    }
    expect(migration.match(/\bEXCEPT\b/gu)).toHaveLength(6);
  });

  it('re-authorizes every blob read and bounds the caller input', () => {
    expect(migration).toContain('WITH reusable AS MATERIALIZED');
    expect(migration).toContain(
      'FROM public.resolve_whatsapp_wwebjs_reusable_handoff_profile_v1('
    );
    expect(migration).toContain(
      'WHERE resolved.revision_id = p_source_revision_id'
    );
    expect(migration).toContain('AND resolved.artifact_id = p_artifact_id');
    expect(migration).toContain('cardinality(p_checksums) BETWEEN 1 AND 128');
    expect(migration).toContain("requested.checksum !~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('blob.sha256 = ANY(p_checksums)');
  });
});
