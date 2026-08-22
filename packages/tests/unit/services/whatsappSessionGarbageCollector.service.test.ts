import 'reflect-metadata';
import type { Pool, PoolClient } from 'pg';
import { WhatsappSessionGarbageCollectorService } from '@core/services/whatsappSessionGarbageCollector.service';

const SESSION_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';
const PROFILE_ARTIFACT_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a6c';
const PROFILE_REVISION_ID = '2';
const PROFILE_DATABASE_NOW = '2026-08-09T15:00:00.000Z';

interface ProfileArtifactCandidate {
  session_id: string;
  revision_id: number | string;
  artifact_id: string;
}

interface ProfileArtifactScenario {
  anchor?: {
    state: 'active' | 'previous';
    retain_until: string | null;
    database_now: string;
  };
  artifact?: {
    status: string;
    provider: string;
    kind: string;
    unanchored_eligible_at: string;
    database_now: string;
  };
  handoffs?: Array<{ pre_activation_artifact_id: string | null }>;
  deleted?: boolean;
  deletedArtifactBlobs?: number;
}

function profileArtifactCandidate(): ProfileArtifactCandidate {
  return {
    session_id: SESSION_ID,
    revision_id: PROFILE_REVISION_ID,
    artifact_id: PROFILE_ARTIFACT_ID,
  };
}

function createProfileArtifactClientQuery(
  scenario: ProfileArtifactScenario
): jest.Mock {
  const artifact = scenario.artifact ?? {
    status: 'retired',
    provider: 'wwebjs',
    kind: 'wwebjs_profile',
    unanchored_eligible_at: '2026-08-08T15:00:00.000Z',
    database_now: PROFILE_DATABASE_NOW,
  };

  return jest.fn(async (statement: string) => {
    if (statement.includes('DELETE FROM whatsapp_artifact AS artifact')) {
      return scenario.deleted === false
        ? { rows: [], rowCount: 0 }
        : {
            rows: [{ artifact_id: PROFILE_ARTIFACT_ID }],
            rowCount: 1,
          };
    }
    if (statement.includes('WITH orphaned AS MATERIALIZED')) {
      return {
        rows: [],
        rowCount: scenario.deletedArtifactBlobs ?? 0,
      };
    }
    if (statement.includes('SELECT session.session_id')) {
      return { rows: [{ session_id: SESSION_ID }], rowCount: 1 };
    }
    if (statement.includes('SELECT revision.revision_id')) {
      return { rows: [{ revision_id: PROFILE_REVISION_ID }], rowCount: 1 };
    }
    if (statement.includes('SELECT handoff.pre_activation_artifact_id')) {
      const rows = scenario.handoffs ?? [];
      return { rows, rowCount: rows.length };
    }
    if (statement.includes('SELECT anchor.state')) {
      const rows = scenario.anchor ? [scenario.anchor] : [];
      return { rows, rowCount: rows.length };
    }
    if (statement.includes('SELECT artifact.status')) {
      return { rows: [artifact], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

function createPool(input?: {
  claims?: Array<Record<string, unknown>>;
  profileCandidates?: ProfileArtifactCandidate[];
  clientQuery?: jest.Mock;
}) {
  const poolQuery = jest.fn(
    async (statement: string, _values?: readonly unknown[]) => {
      if (statement.includes('WITH expired AS MATERIALIZED')) {
        return { rows: [], rowCount: 0 };
      }
      if (statement.includes('WITH candidates AS MATERIALIZED')) {
        return {
          rows: input?.claims ?? [],
          rowCount: input?.claims?.length ?? 0,
        };
      }
      if (
        statement.includes('FROM whatsapp_artifact AS artifact') &&
        statement.includes('LEFT JOIN whatsapp_wwebjs_profile_anchor')
      ) {
        return {
          rows: input?.profileCandidates ?? [],
          rowCount: input?.profileCandidates?.length ?? 0,
        };
      }
      return { rows: [], rowCount: 0 };
    }
  );
  const client = {
    query:
      input?.clientQuery ?? jest.fn(async () => ({ rows: [], rowCount: 0 })),
    release: jest.fn(),
  } as unknown as PoolClient;
  const pool = {
    query: poolQuery,
    connect: jest.fn(async () => client),
  } as unknown as Pool;
  return { pool, poolQuery, client };
}

describe('WhatsappSessionGarbageCollectorService', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses bounded defaults for revision, profile artifact, and blob batches', async () => {
    const harness = createPool();
    const service = new WhatsappSessionGarbageCollectorService(harness.pool);

    await expect(service.collectOnce()).resolves.toMatchObject({
      claimed: 0,
      deletedRevisions: 0,
      profileArtifactsScanned: 0,
      deletedProfileArtifacts: 0,
      skipped: false,
    });

    const recovery = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes('WITH expired AS MATERIALIZED')
    );
    const claim = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes('WITH candidates AS MATERIALIZED')
    );
    const profileScan = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes('LEFT JOIN whatsapp_wwebjs_profile_anchor')
    );
    const orphanSweep = harness.poolQuery.mock.calls.find(
      ([sql]) =>
        String(sql).includes('FROM whatsapp_artifact_blob AS blob') &&
        !String(sql).includes('blob.session_id = $1::uuid')
    );
    expect(String(recovery?.[0])).toContain('FOR UPDATE OF queue SKIP LOCKED');
    expect(recovery?.[1]).toEqual([50]);
    expect(String(claim?.[0])).toContain('FOR UPDATE OF queue SKIP LOCKED');
    expect(String(claim?.[0])).toContain('LIMIT $1');
    expect(claim?.[1]).toEqual([25, expect.any(String), 10 * 60_000]);
    expect(String(profileScan?.[0])).toContain("anchor.state = 'previous'");
    expect(String(profileScan?.[0])).toContain('anchor.session_id IS NULL');
    expect(String(profileScan?.[0])).not.toContain("anchor.state = 'active'");
    expect(profileScan?.[1]).toEqual([100, 24 * 60 * 60_000]);
    expect(String(orphanSweep?.[0])).toContain(
      'FROM whatsapp_artifact_blob AS blob'
    );
    expect(String(orphanSweep?.[0])).toContain(
      'FOR UPDATE OF blob SKIP LOCKED'
    );
    expect(orphanSweep?.[1]).toEqual([1_000, 60 * 60_000]);
    expect(harness.pool.connect).not.toHaveBeenCalled();
  });

  it('deletes an expired previous profile artifact only after the canonical lock order', async () => {
    const clientQuery = createProfileArtifactClientQuery({
      anchor: {
        state: 'previous',
        retain_until: '2026-08-09T14:59:59.000Z',
        database_now: PROFILE_DATABASE_NOW,
      },
      deletedArtifactBlobs: 3,
    });
    const harness = createPool({
      profileCandidates: [profileArtifactCandidate()],
      clientQuery,
    });
    const service = new WhatsappSessionGarbageCollectorService(harness.pool);

    await expect(service.collectOnce()).resolves.toMatchObject({
      profileArtifactsScanned: 1,
      deletedProfileArtifacts: 1,
      deferredProfileArtifacts: 0,
      deletedArtifactBlobs: 3,
      errors: 0,
    });

    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    const sessionLock = statements.findIndex((sql) =>
      sql.includes('FOR UPDATE OF session')
    );
    const revisionLock = statements.findIndex((sql) =>
      sql.includes('FOR UPDATE OF revision')
    );
    const handoffLock = statements.findIndex((sql) =>
      sql.includes('FOR UPDATE OF handoff')
    );
    const anchorLock = statements.findIndex((sql) =>
      sql.includes('FOR UPDATE OF anchor')
    );
    const artifactLock = statements.findIndex((sql) =>
      sql.includes('FOR UPDATE OF artifact')
    );
    const artifactDelete = statements.findIndex((sql) =>
      sql.includes('DELETE FROM whatsapp_artifact AS artifact')
    );
    const blobDelete = statements.findIndex((sql) =>
      sql.includes('WITH orphaned AS MATERIALIZED')
    );

    expect(sessionLock).toBeGreaterThan(-1);
    expect(revisionLock).toBeGreaterThan(sessionLock);
    expect(handoffLock).toBeGreaterThan(revisionLock);
    expect(anchorLock).toBeGreaterThan(handoffLock);
    expect(artifactLock).toBeGreaterThan(anchorLock);
    expect(artifactDelete).toBeGreaterThan(artifactLock);
    expect(blobDelete).toBeGreaterThan(artifactDelete);

    const deleteCall = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('DELETE FROM whatsapp_artifact AS artifact')
    );
    expect(String(deleteCall?.[0])).toContain(
      "expired_anchor.state = 'previous'"
    );
    expect(String(deleteCall?.[0])).toContain(
      'expired_anchor.retain_until <= statement_timestamp()'
    );
    expect(String(deleteCall?.[0])).toContain(
      'FROM whatsapp_wwebjs_profile_anchor AS any_anchor'
    );
    expect(String(deleteCall?.[0])).toContain(
      "$4::double precision * interval '1 millisecond'"
    );
    expect(String(deleteCall?.[0])).toContain(
      'retained_handoff.pre_activation_artifact_id ='
    );
    expect(deleteCall?.[1]).toEqual([
      SESSION_ID,
      Number(PROFILE_REVISION_ID),
      PROFILE_ARTIFACT_ID,
      24 * 60 * 60_000,
    ]);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(harness.client.release).toHaveBeenCalledTimes(1);
  });

  it('defers a previous profile artifact whose retention moved into the future', async () => {
    const clientQuery = createProfileArtifactClientQuery({
      anchor: {
        state: 'previous',
        retain_until: '2026-08-09T15:00:01.000Z',
        database_now: PROFILE_DATABASE_NOW,
      },
    });
    const harness = createPool({
      profileCandidates: [profileArtifactCandidate()],
      clientQuery,
    });
    const service = new WhatsappSessionGarbageCollectorService(harness.pool);

    await expect(service.collectOnce()).resolves.toMatchObject({
      profileArtifactsScanned: 1,
      deletedProfileArtifacts: 0,
      deferredProfileArtifacts: 1,
      errors: 0,
    });

    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(
      statements.some((sql) =>
        sql.includes('DELETE FROM whatsapp_artifact AS artifact')
      )
    ).toBe(false);
    expect(
      statements.some((sql) => sql.includes('FOR UPDATE OF artifact'))
    ).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('preserves an expired profile artifact referenced by any handoff pre-activation boundary', async () => {
    const clientQuery = createProfileArtifactClientQuery({
      anchor: {
        state: 'previous',
        retain_until: '2026-08-09T14:00:00.000Z',
        database_now: PROFILE_DATABASE_NOW,
      },
      handoffs: [{ pre_activation_artifact_id: PROFILE_ARTIFACT_ID }],
    });
    const harness = createPool({
      profileCandidates: [profileArtifactCandidate()],
      clientQuery,
    });
    const service = new WhatsappSessionGarbageCollectorService(harness.pool);

    await expect(service.collectOnce()).resolves.toMatchObject({
      profileArtifactsScanned: 1,
      deletedProfileArtifacts: 0,
      deferredProfileArtifacts: 1,
      errors: 0,
    });

    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    const handoffLock = statements.find((sql) =>
      sql.includes('FOR UPDATE OF handoff')
    );
    expect(handoffLock).toContain(
      'handoff.pre_activation_artifact_id = $3::uuid'
    );
    expect(statements.some((sql) => sql.includes('SELECT anchor.state'))).toBe(
      false
    );
    expect(
      statements.some((sql) =>
        sql.includes('DELETE FROM whatsapp_artifact AS artifact')
      )
    ).toBe(false);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('deletes an old unanchored retired profile artifact', async () => {
    const clientQuery = createProfileArtifactClientQuery({
      artifact: {
        status: 'retired',
        provider: 'wwebjs',
        kind: 'wwebjs_profile',
        unanchored_eligible_at: '2026-08-09T14:59:59.000Z',
        database_now: PROFILE_DATABASE_NOW,
      },
      deletedArtifactBlobs: 1,
    });
    const harness = createPool({
      profileCandidates: [profileArtifactCandidate()],
      clientQuery,
    });
    const service = new WhatsappSessionGarbageCollectorService(harness.pool);

    await expect(service.collectOnce()).resolves.toMatchObject({
      profileArtifactsScanned: 1,
      deletedProfileArtifacts: 1,
      deferredProfileArtifacts: 0,
      deletedArtifactBlobs: 1,
      errors: 0,
    });

    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('SELECT anchor.state'))).toBe(
      true
    );
    expect(
      statements.some((sql) =>
        sql.includes('DELETE FROM whatsapp_artifact AS artifact')
      )
    ).toBe(true);
  });

  it('never deletes an active profile anchor even if a stale scan returns it', async () => {
    const clientQuery = createProfileArtifactClientQuery({
      anchor: {
        state: 'active',
        retain_until: null,
        database_now: PROFILE_DATABASE_NOW,
      },
    });
    const harness = createPool({
      profileCandidates: [profileArtifactCandidate()],
      clientQuery,
    });
    const service = new WhatsappSessionGarbageCollectorService(harness.pool);

    await expect(service.collectOnce()).resolves.toMatchObject({
      profileArtifactsScanned: 1,
      deletedProfileArtifacts: 0,
      deferredProfileArtifacts: 1,
      errors: 0,
    });

    expect(
      clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes('DELETE FROM whatsapp_artifact AS artifact')
      )
    ).toBe(false);
  });

  it('preserves a previous revision while its terminal handoff is inside the rollback window', async () => {
    const protectedUntil = new Date(Date.now() + 60_000).toISOString();
    const databaseNow = new Date().toISOString();
    const clientQuery = jest.fn(
      async (statement: string, _values?: readonly unknown[]) => {
        if (statement.includes('FROM whatsapp_session AS session')) {
          return {
            rows: [
              {
                state: 'ready',
                active_revision_id: '2',
                previous_revision_id: '1',
              },
            ],
            rowCount: 1,
          };
        }
        if (statement.includes('FROM whatsapp_session_revision AS revision')) {
          return {
            rows: [
              {
                status: 'retired',
                eligible_at: '2026-01-01T00:00:00.000Z',
                database_now: databaseNow,
              },
            ],
            rowCount: 1,
          };
        }
        if (statement.includes('FROM whatsapp_session_handoff AS handoff')) {
          return {
            rows: [
              {
                state: 'completed',
                protected_until: protectedUntil,
                database_now: databaseNow,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
    );
    const harness = createPool({
      claims: [
        {
          session_id: SESSION_ID,
          revision_id: '1',
          revision_status: 'retired',
        },
      ],
      clientQuery,
    });
    const service = new WhatsappSessionGarbageCollectorService(harness.pool);

    await expect(service.collectOnce()).resolves.toMatchObject({
      claimed: 1,
      deletedRevisions: 0,
      deferred: 1,
      errors: 0,
    });

    expect(
      clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes('DELETE FROM whatsapp_session_revision')
      )
    ).toBe(false);
    const defer = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('eligible_at = GREATEST')
    );
    expect(defer?.[1]).toEqual([
      SESSION_ID,
      '1',
      expect.any(String),
      new Date(protectedUntil),
    ]);
    expect(harness.client.release).toHaveBeenCalledTimes(1);
  });

  it('defers GC while a handoff is activating the target revision', async () => {
    const databaseNow = new Date().toISOString();
    const clientQuery = jest.fn(
      async (statement: string, _values?: readonly unknown[]) => {
        if (statement.includes('FROM whatsapp_session AS session')) {
          return {
            rows: [
              {
                state: 'ready',
                active_revision_id: '2',
                previous_revision_id: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (statement.includes('FROM whatsapp_session_revision AS revision')) {
          return {
            rows: [
              {
                status: 'staging',
                eligible_at: '2026-01-01T00:00:00.000Z',
                database_now: databaseNow,
              },
            ],
            rowCount: 1,
          };
        }
        if (statement.includes('FROM whatsapp_session_handoff AS handoff')) {
          return {
            rows: [
              {
                state: 'activating',
                recovery_state: 'none',
                protected_until: databaseNow,
                database_now: databaseNow,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
    );
    const harness = createPool({
      claims: [
        {
          session_id: SESSION_ID,
          revision_id: '1',
          revision_status: 'staging',
        },
      ],
      clientQuery,
    });
    const service = new WhatsappSessionGarbageCollectorService(harness.pool);

    await expect(service.collectOnce()).resolves.toMatchObject({
      claimed: 1,
      deletedRevisions: 0,
      deferred: 1,
      errors: 0,
    });

    expect(
      clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes('DELETE FROM whatsapp_session_revision')
      )
    ).toBe(false);
    const defer = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("$4::double precision * interval '1 millisecond'")
    );
    expect(defer?.[1]).toEqual([
      SESSION_ID,
      '1',
      expect.any(String),
      60 * 60_000,
    ]);
  });

  it('deletes an expired retired revision only after locking and clearing its rollback references', async () => {
    const databaseNow = new Date().toISOString();
    const clientQuery = jest.fn(
      async (statement: string, _values?: readonly unknown[]) => {
        if (statement.includes('FROM whatsapp_session AS session')) {
          return {
            rows: [
              {
                state: 'ready',
                active_revision_id: '2',
                previous_revision_id: '1',
              },
            ],
            rowCount: 1,
          };
        }
        if (statement.includes('FROM whatsapp_session_revision AS revision')) {
          return {
            rows: [
              {
                status: 'retired',
                eligible_at: '2026-01-01T00:00:00.000Z',
                database_now: databaseNow,
              },
            ],
            rowCount: 1,
          };
        }
        if (statement.includes('FROM whatsapp_session_handoff AS handoff')) {
          return {
            rows: [
              {
                state: 'completed',
                protected_until: '2026-01-02T00:00:00.000Z',
                database_now: databaseNow,
              },
            ],
            rowCount: 1,
          };
        }
        if (statement.includes('DELETE FROM whatsapp_session_revision')) {
          return { rows: [{ revision_id: '1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    );
    const harness = createPool({
      claims: [
        {
          session_id: SESSION_ID,
          revision_id: '1',
          revision_status: 'retired',
        },
      ],
      clientQuery,
    });
    const service = new WhatsappSessionGarbageCollectorService(harness.pool);

    await expect(service.collectOnce()).resolves.toMatchObject({
      claimed: 1,
      deletedRevisions: 1,
      deferred: 0,
      errors: 0,
    });

    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    const sessionLock = statements.findIndex((sql) =>
      sql.includes('FOR UPDATE OF session')
    );
    const revisionLock = statements.findIndex((sql) =>
      sql.includes('FOR UPDATE OF revision')
    );
    const handoffLock = statements.findIndex((sql) =>
      sql.includes('FOR UPDATE OF handoff')
    );
    const handoffDelete = statements.findIndex((sql) =>
      sql.includes('DELETE FROM whatsapp_session_handoff')
    );
    const previousClear = statements.findIndex((sql) =>
      sql.includes('SET previous_revision_id = NULL')
    );
    const revisionDelete = statements.findIndex((sql) =>
      sql.includes('DELETE FROM whatsapp_session_revision')
    );
    expect(sessionLock).toBeGreaterThan(-1);
    expect(revisionLock).toBeGreaterThan(sessionLock);
    expect(handoffLock).toBeGreaterThan(revisionLock);
    expect(handoffDelete).toBeGreaterThan(handoffLock);
    expect(previousClear).toBeGreaterThan(handoffDelete);
    expect(revisionDelete).toBeGreaterThan(previousClear);
    expect(statements).toContain('COMMIT');
  });
});
