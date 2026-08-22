import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260819211500.sql'),
  'utf8'
);

describe('WhatsApp session lease reconnect tail PostgreSQL contract', () => {
  it('extends the persisted minimum to 90 seconds', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.enforce_whatsapp_session_lease_min_ttl_v1()'
    );
    expect(migration).toContain(
      `NEW."heartbeat_at" + interval '90 seconds'`
    );
    expect(migration).toContain('NEW."expires_at" := GREATEST(');
  });

  it('preserves the owned-lease guard and least privilege', () => {
    expect(migration).toContain('NEW."owner_id" IS NOT NULL');
    expect(migration).toContain('NEW."heartbeat_at" IS NOT NULL');
    expect(migration).toContain('NEW."expires_at" IS NOT NULL');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('REVOKE ALL');
    expect(migration).toContain('FROM PUBLIC;');
  });
});
