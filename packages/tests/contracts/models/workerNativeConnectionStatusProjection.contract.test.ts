import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projections = [
  'packages/repositories/worker/WorkerLister.repository.ts',
  'packages/repositories/worker/WorkerViewer.repository.ts',
  'packages/repositories/dashboard/DashboardOfflineChannels.repository.ts',
].map((path) => ({
  path,
  source: readFileSync(resolve(process.cwd(), path), 'utf8'),
}));
const effectiveOnlineSqlSource = readFileSync(
  resolve(
    process.cwd(),
    'packages/repositories/worker/workerEffectiveOnline.sql.ts'
  ),
  'utf8'
);

describe('native WhatsApp status read projection', () => {
  it.each(projections)(
    'reads $path from the one-row materialized runtime projection',
    ({ source }) => {
      expect(source).toContain('workerRuntime.native_connection_public_status');
      expect(source).toContain(
        'workerRuntime.native_connection_status_source_id'
      );
      expect(source).toContain(
        'workerRuntime.native_connection_status_outbox_id'
      );
      expect(
        source.includes(
          'workerRuntime.native_connection_online_acknowledged'
        ) ||
          (source.includes('effectiveWorkerOnlinePredicate()') &&
            effectiveOnlineSqlSource.includes(
              'workerRuntime.native_connection_online_acknowledged} IS TRUE'
            ))
      ).toBe(true);
      expect(source).not.toContain('worker_runtime_event_outbox');
      expect(source).not.toContain('ORDER BY event.');
    }
  );

  it.each(projections)(
    'validates the persisted snapshot and source together before exposing $path',
    ({ source }) => {
      expect(source).toContain('normalizeWhatsappConnectionStatus(');
      expect(source).toContain('normalizeWhatsappConnectionStatusSourceId(');
    }
  );

  it.each(projections)(
    'rechecks the exact PostgreSQL lease generation/epoch before exposing acknowledged ONLINE in $path',
    ({ source }) => {
      expect(source).toContain('whatsappSessionLease');
      expect(
        source.includes('liveWhatsappSessionLeaseJoinCondition()') ||
          source.includes(
            'eq(whatsappSessionLease.generation, workerRuntime.runtime_generation)'
          )
      ).toBe(true);
    }
  );

  it('keeps the shared live-lease join exact and fail-closed', () => {
    expect(effectiveOnlineSqlSource).toContain(
      'whatsappSessionLease.generation} = ${workerRuntime.runtime_generation}'
    );
    expect(effectiveOnlineSqlSource).toContain(
      'whatsappSessionLease.epoch} = ${workerRuntime.session_writer_epoch}'
    );
    expect(effectiveOnlineSqlSource).toContain(
      'whatsappSessionLease.owner_id} = ${workerRuntime.native_connection_status_lease_owner_id}'
    );
    expect(effectiveOnlineSqlSource).toContain(
      'whatsappSessionLease.fencing_token} = ${workerRuntime.native_connection_status_fencing_token}'
    );
    expect(effectiveOnlineSqlSource).toContain(
      "whatsappSessionLease.expires_at} > clock_timestamp() + interval '5 seconds'"
    );
  });

  it('uses worker.worker_status_id for worker rows, filters and totals', () => {
    const source = projections.find(({ path }) =>
      path.endsWith('WorkerLister.repository.ts')
    )?.source;

    expect(source).toBeDefined();
    expect(source).not.toContain('effectiveWorkerStatusIdExpression()');
    expect(source).toContain(
      'filters.push(eq(worker.worker_status_id, query.status))'
    );
    expect(source).toContain('status: item.status');
    expect(effectiveOnlineSqlSource).toContain(
      'effectiveWorkerOnlinePredicate()'
    );
    expect(effectiveOnlineSqlSource).toContain(
      'workerRuntime.native_connection_online_acknowledged} IS TRUE'
    );

    const totalProjection = source?.slice(
      source.indexOf('listWorkerTotal = async')
    );
    expect(totalProjection).not.toContain('.leftJoin(workerRuntime');
    expect(totalProjection).not.toContain('.leftJoin(whatsappSessionLease');
  });
});
