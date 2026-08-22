import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface GuardProbe {
  statusCode: number | null;
  calls: {
    users: Array<[string, string]>;
    roles: Array<[string, string]>;
    sectors: Array<[string[], string]>;
    channels: Array<[string[], string]>;
    discovery: string[];
  };
}

interface PublicUserScopeProbe {
  targetOutsideAccount: GuardProbe;
  protectedRole: GuardProbe;
  invalidRole: GuardProbe;
  roleOutsideAccount: GuardProbe;
  invalidSector: GuardProbe;
  sectorOutsideAccount: GuardProbe;
  invalidChannel: GuardProbe;
  channelOutsideAccount: GuardProbe;
  discovery: GuardProbe & { payload: unknown };
  strictMultipart: {
    validStatusCode: number;
    accountIdStatusCode: number;
  };
}

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_USER_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const SECTOR_ID = '44444444-4444-4444-8444-444444444444';
const CHANNEL_ID = '55555555-5555-4555-8555-555555555555';

function runProbe(): PublicUserScopeProbe {
  const executable = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
  const helper = path.resolve(
    process.cwd(),
    'apps/public_api/src/openapi/publicUserScopeContractProbe.ts'
  );
  const output = execFileSync(
    executable,
    ['--tsconfig', 'apps/public_api/tsconfig.tsx.json', helper],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
    }
  );
  const payloadLine = output
    .split('\n')
    .find((line) => line.startsWith('PUBLIC_USER_SCOPE_CONTRACT:'));

  if (!payloadLine) {
    throw new Error(`Public user scope probe did not respond: ${output}`);
  }

  return JSON.parse(
    payloadLine.slice('PUBLIC_USER_SCOPE_CONTRACT:'.length)
  ) as PublicUserScopeProbe;
}

describe('PUBLIC user account scope guards', () => {
  let probe: PublicUserScopeProbe;

  beforeAll(() => {
    probe = runProbe();
  });

  it('returns 404 for a target outside the token account even with full_access', () => {
    expect(probe.targetOutsideAccount.statusCode).toBe(404);
    expect(probe.targetOutsideAccount.calls.users).toEqual([
      [TARGET_USER_ID, ACCOUNT_ID],
    ]);
  });

  it('rejects protected, invalid and cross-account roles', () => {
    expect(probe.protectedRole.statusCode).toBe(403);
    expect(probe.protectedRole.calls.roles).toHaveLength(0);
    expect(probe.invalidRole.statusCode).toBe(400);
    expect(probe.invalidRole.calls.roles).toHaveLength(0);
    expect(probe.roleOutsideAccount.statusCode).toBe(400);
    expect(probe.roleOutsideAccount.calls.roles).toEqual([
      [ROLE_ID, ACCOUNT_ID],
    ]);
  });

  it('rejects invalid and cross-account sectors', () => {
    expect(probe.invalidSector.statusCode).toBe(400);
    expect(probe.invalidSector.calls.sectors).toHaveLength(0);
    expect(probe.sectorOutsideAccount.statusCode).toBe(400);
    expect(probe.sectorOutsideAccount.calls.sectors).toEqual([
      [[SECTOR_ID], ACCOUNT_ID],
    ]);
  });

  it('rejects invalid and cross-account channels from multipart fields', () => {
    expect(probe.invalidChannel.statusCode).toBe(400);
    expect(probe.invalidChannel.calls.channels).toHaveLength(0);
    expect(probe.channelOutsideAccount.statusCode).toBe(400);
    expect(probe.channelOutsideAccount.calls.channels).toEqual([
      [[CHANNEL_ID], ACCOUNT_ID],
    ]);
  });

  it('uses only the token account for account-scoped discovery', () => {
    expect(probe.discovery.statusCode).toBe(200);
    expect(probe.discovery.calls.discovery).toEqual([ACCOUNT_ID]);
    expect(probe.discovery.payload).toEqual(
      expect.objectContaining({
        status: true,
        data: [
          expect.objectContaining({
            user_id: TARGET_USER_ID,
            account_id: ACCOUNT_ID,
          }),
        ],
      })
    );
  });

  it('accepts valid multipart wrappers while rejecting account_id', () => {
    expect(probe.strictMultipart.validStatusCode).toBe(200);
    expect(probe.strictMultipart.accountIdStatusCode).toBe(400);
  });

  it('keeps active, non-deleted users with active roles in the discovery query', () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'apps/public_api/src/repositories/PublicUserScope.repository.ts'
      ),
      'utf8'
    );

    expect(source).toContain('eq(user.user_status_id, EUserStatus.active)');
    expect(source).toContain('isNull(user.deleted_at)');
    expect(source).toContain(
      'eq(permissionRole.status, EPermissionRoleStatus.active)'
    );
    expect(source).toContain('isNull(permissionRole.deleted_at)');
  });
});
