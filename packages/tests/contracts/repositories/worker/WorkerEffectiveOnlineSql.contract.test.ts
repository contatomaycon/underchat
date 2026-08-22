import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const onlineConsumers = [
  'packages/repositories/dashboard/DashboardStats.repository.ts',
  'packages/repositories/dashboard/DashboardOfflineChannels.repository.ts',
  'packages/repositories/worker/WorkerAllLister.repository.ts',
  'packages/repositories/worker/WorkerActiveByAccountViewer.repository.ts',
  'packages/repositories/worker/WorkerConfigViewer.repository.ts',
];
const visibleStatusConsumers = [
  'packages/repositories/dashboard/DashboardChannelsStatus.repository.ts',
  'packages/repositories/config/ChannelsLister.repository.ts',
  'packages/repositories/config/ChannelsStatistics.repository.ts',
];

describe('shared effective worker ONLINE SQL', () => {
  const helper = readSource(
    'packages/repositories/worker/workerEffectiveOnline.sql.ts'
  );

  it('requires native proof, matching storage/provider and an exact live PostgreSQL lease', () => {
    expect(helper).toContain('worker.lifecycle_operation_id} IS NULL');
    expect(helper).toContain('native_connection_online_acknowledged} IS TRUE');
    expect(helper).toContain(
      'workerRuntime.session_storage} = ${worker.session_storage}'
    );
    expect(helper).toContain(
      "native_connection_status} ->> 'status' = 'online'"
    );
    expect(helper).toContain('native_connection_status_source_id} IS NOT NULL');
    expect(helper).toContain('native_connection_status_sequence}');
    expect(helper).toContain('native_connection_status_outbox_id} > 0');
    expect(helper).toContain("native_connection_status} -> 'connected' =");
    expect(helper).toContain("native_connection_status} -> 'authenticated' =");
    expect(helper).toContain("native_connection_status} -> 'sessionValid' =");
    expect(helper).toContain("native_connection_status} -> 'qrAvailable' =");
    expect(helper).toContain("native_connection_public_status} ->> 'status' =");
    expect(helper).toContain(
      'whatsappSessionLease.provider} = ${workerRuntime.source_provider}'
    );
    expect(helper).toContain(
      'whatsappSessionLease.generation} = ${workerRuntime.runtime_generation}'
    );
    expect(helper).toContain(
      'whatsappSessionLease.epoch} = ${workerRuntime.session_writer_epoch}'
    );
    expect(helper).toContain(
      "whatsappSessionLease.expires_at} > clock_timestamp() + interval '5 seconds'"
    );
  });

  it('keeps an active official Meta connection operational during legacy disponible drift', () => {
    expect(helper).toContain(
      'worker.worker_type_id} = ${EWorkerType.whatsapp}'
    );
    expect(helper).toContain(
      'worker.worker_status_id} = ${EWorkerStatus.disponible}'
    );
    expect(helper).toContain(
      'FROM ${workerWhatsappOfficialConnection} official_connection'
    );
    expect(helper).toContain('official_connection.deleted_at IS NULL');
  });

  it.each(onlineConsumers)(
    'uses the shared effective-online predicate in %s',
    (path) => {
      const source = readSource(path);
      expect(source).toContain('effectiveWorkerOnlinePredicate()');
      expect(source).toContain('liveWhatsappSessionLeaseJoinCondition()');
    }
  );

  it.each(visibleStatusConsumers)(
    'keeps worker.worker_status_id as the visible status in %s',
    (path) => {
      const source = readSource(path);
      expect(source).not.toContain('effectiveWorkerStatusIdExpression()');
      expect(source).not.toContain('effectiveWorkerStatusNameExpression()');
      expect(source).not.toContain('effective_status_id');
    }
  );
});
