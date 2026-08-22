import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConnectionLogsQuery } from '@core/schema/worker/workerConnectionLogs/request.schema';
import {
  WorkerConnectionHealthResponse,
  WorkerConnectionLogItem,
} from '@core/schema/worker/workerConnectionLogs/response.schema';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerConnectionHealthRepository } from '@core/repositories/worker/WorkerConnectionHealth.repository';

const supportedWorkerTypes = new Set<string>([
  EWorkerType.baileys,
  EWorkerType.wwebjs,
  EWorkerType.whatsmeow,
]);

const customerSafeDiagnosticAliases = new Map<string, string>([
  [
    'wwebjs_canonical_app_state_restore_restart_required',
    'session_restore_restart_required',
  ],
  ['wwebjs_canonical_connected_timeout', 'connection_validation_timeout'],
  ['wwebjs_canonical_forward_recovery_required', 'session_recovery_required'],
  [
    'wwebjs_canonical_initial_app_state_stability_timeout',
    'session_validation_timeout',
  ],
  ['wwebjs_connection_error', 'connection_error'],
  ['whatsapp_session_lease_lost', 'session_lease_lost'],
  ['connect_failure_401', 'authentication_revoked'],
  ['enospc', 'storage_unavailable'],
]);

const sanitizeConnectionDiagnostic = (
  value: string | null | undefined
): string | null => {
  if (!value) return null;

  const trimmed = value.trim();
  const alias = customerSafeDiagnosticAliases.get(trimmed.toLowerCase());
  if (alias) return alias;

  return trimmed
    .replace(
      /(?:baileys|wwebjs|whatsmeow)connectionservice/giu,
      'connection_service'
    )
    .replace(/(?:baileys|wwebjs|whatsmeow)/giu, 'connection')
    .replace(/connection(?:[_\s.-]+)connection/giu, 'connection')
    .replace(/^[_\s.-]+|[_\s.-]+$/gu, '');
};

@injectable()
export class WorkerConnectionLogsUseCase {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerConnectionHealthRepository)
    private readonly workerConnectionHealthRepository: WorkerConnectionHealthRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    query: WorkerConnectionLogsQuery
  ): Promise<WorkerConnectionHealthResponse> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (
      worker.session_storage !== EWorkerSessionStorage.postgres ||
      !worker.type?.id ||
      !supportedWorkerTypes.has(worker.type.id)
    ) {
      throw new Error(t('worker_connection_health_database_only'));
    }

    const from = query.from ?? 0;
    const size = query.size ?? 100;
    const sort = query.sort ?? ESortOrder.desc;
    const periodHours = query.period_hours ?? 24;

    const queryElastic = {
      from: from,
      size: size + 1,
      sort: [{ date: sort }],
      query: {
        term: { worker_id: workerId },
      },
    };

    const [health, elasticResult] = await Promise.all([
      this.workerConnectionHealthRepository.view({
        accountId,
        workerId,
        periodHours,
      }),
      this.elasticDatabaseService.select(
        EElasticIndex.wpp_connection,
        queryElastic
      ),
    ]);

    if (!health) {
      throw new Error(t('worker_connection_health_unavailable'));
    }

    const elasticHits = elasticResult?.hits?.hits ?? [];
    const logs = elasticHits
      .slice(0, size)
      .map((hit): WorkerConnectionLogItem | null => {
        const source = hit?._source as Partial<WorkerConnectionLogItem>;
        if (!source || typeof source.date !== 'string') {
          return null;
        }

        return {
          status:
            typeof source.status === 'string' || source.status === null
              ? sanitizeConnectionDiagnostic(source.status)
              : null,
          code:
            typeof source.code === 'string'
              ? sanitizeConnectionDiagnostic(source.code)
              : typeof source.code === 'number' || source.code === null
                ? source.code
                : null,
          message:
            typeof source.message === 'string' || source.message === null
              ? sanitizeConnectionDiagnostic(source.message)
              : null,
          date: source.date,
        };
      })
      .filter((item): item is WorkerConnectionLogItem => item !== null);

    return {
      ...health,
      current_status: health.current_status
        ? {
            ...health.current_status,
            reason: sanitizeConnectionDiagnostic(health.current_status.reason),
            error_code: sanitizeConnectionDiagnostic(
              health.current_status.error_code
            ),
          }
        : null,
      events: health.events.map((event) => ({
        ...event,
        reason: sanitizeConnectionDiagnostic(event.reason),
        error_code: sanitizeConnectionDiagnostic(event.error_code),
        code:
          typeof event.code === 'string'
            ? sanitizeConnectionDiagnostic(event.code)
            : event.code,
      })),
      logs,
      logs_has_more: elasticHits.length > size,
    };
  }
}
