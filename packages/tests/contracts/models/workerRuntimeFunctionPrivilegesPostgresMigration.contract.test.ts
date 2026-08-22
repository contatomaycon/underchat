import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const revokeMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260801223500.sql'),
  'utf8'
);
const defaultPrivilegesMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260801224500.sql'),
  'utf8'
);

describe('worker runtime PostgreSQL function privileges', () => {
  it('removes PUBLIC execution from every capability-fenced SECURITY DEFINER function', () => {
    for (const signature of [
      'public.activate_whatsapp_runtime_fence(\n  uuid, uuid, text, integer, uuid, text, text, uuid\n)',
      'public.apply_worker_runtime_status(\n  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid\n)',
      'public.hydrate_whatsapp_warm_runtime(\n  uuid, text, text\n)',
      'public.request_worker_self_heal(\n  uuid, uuid, text, integer, uuid, text, text, text, jsonb, text\n)',
    ]) {
      expect(revokeMigration).toContain(
        `REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC;`
      );
    }
  });

  it('prevents future Atlas-owned functions from receiving implicit PUBLIC execution', () => {
    expect(defaultPrivilegesMigration).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public'
    );
    expect(defaultPrivilegesMigration).toContain(
      'REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;'
    );
  });
});
