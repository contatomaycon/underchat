import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('WWebJS revision-open RLS scope migration', () => {
  const migrationPath = resolve(process.cwd(), 'atlas/prod/20260804151000.sql');
  const migration = readFileSync(migrationPath, 'utf8');

  it('mints the complete signed runtime scope before returning the opened revision', () => {
    const openFunction = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.open_whatsapp_session_revision('
    );
    const signature = migration.indexOf(
      'PERFORM public.issue_whatsapp_runtime_scope_signature();',
      openFunction
    );
    const returnedRevision = migration.indexOf(
      'RETURN QUERY SELECT v_revision_id, v_status, v_handoff_id;',
      openFunction
    );

    expect(openFunction).toBeGreaterThanOrEqual(0);
    expect(signature).toBeGreaterThan(openFunction);
    expect(returnedRevision).toBeGreaterThan(signature);

    for (const setting of [
      'app.whatsapp_session_id',
      'app.whatsapp_revision_id',
      'app.whatsapp_owner_id',
      'app.whatsapp_fencing_token',
      'app.whatsapp_generation',
      'app.whatsapp_epoch',
      'app.whatsapp_capability',
      'app.whatsapp_lease_provider',
      'app.whatsapp_provider',
    ]) {
      const settingPosition = migration.indexOf(
        `PERFORM set_config('${setting}'`,
        openFunction
      );
      expect(settingPosition).toBeGreaterThan(openFunction);
      expect(settingPosition).toBeLessThan(signature);
    }
  });

  it('keeps the public ACL closed and grants only the shared runtime role', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.open_whatsapp_session_revision('
    );
    expect(migration).toContain(') FROM PUBLIC;');
    expect(migration).toContain(') TO whatsapp_session_runtime;');
  });
});
