import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { WorkerServerListerRepository } from '@core/repositories/worker/WorkerServerLister.repository';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { WorkerWarmPoolQueueService } from '@core/services/workerWarmPoolQueue.service';
import { workerPoolEnvironment } from '@core/config/environments';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { currentTime } from '@core/common/functions/currentTime';
import { logger } from '@core/plugins/telemetry/logger';

const WARM_WORKER_TYPES = [
  EWorkerType.baileys,
  EWorkerType.wwebjs,
  EWorkerType.whatsmeow,
];

@injectable()
export class WorkerWarmPoolActivity {
  constructor(
    @inject(WorkerServerListerRepository)
    private readonly workerServerListerRepository: WorkerServerListerRepository,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository,
    @inject(WorkerWarmPoolQueueService)
    private readonly workerWarmPoolQueueService: WorkerWarmPoolQueueService
  ) {}

  async scan(): Promise<void> {
    if (!workerPoolEnvironment.warmWorkerPoolEnabled) {
      return;
    }

    const startedAt = Date.now();
    await this.workerWarmPoolQueueService.ensure();
    const releasedReservations =
      await this.workerWarmPoolRepository.releaseExpiredReservations();
    const servers =
      await this.workerServerListerRepository.listWarmPoolEligibleServers();
    const target = workerPoolEnvironment.warmWorkerTargetReady;
    let replenishPublished = 0;

    for (const server of servers) {
      for (const workerTypeId of WARM_WORKER_TYPES) {
        const activeCount =
          await this.workerWarmPoolRepository.countActiveByServerAndType(
            server.server_id,
            workerTypeId
          );
        const missing = Math.max(0, target - activeCount);

        logger.info(
          {
            type: 'warm_pool.scan',
            server_id: server.server_id,
            worker_type_id: workerTypeId,
            active_count: activeCount,
            target_count: target,
            missing_count: missing,
          },
          'Warm worker pool scan'
        );

        for (let index = 0; index < missing; index++) {
          await this.workerWarmPoolQueueService.publishReplenish({
            request_id: uuidv7(),
            server_id: server.server_id,
            worker_type_id: workerTypeId,
            reason: 'scheduled_scan',
            requested_at: currentTime(),
          });
          replenishPublished += 1;
        }
      }
    }

    logger.info(
      {
        type: 'warm_pool.scan.summary',
        duration_ms: Date.now() - startedAt,
        servers_count: servers.length,
        target_count: target,
        released_reservations: releasedReservations,
        replenish_published: replenishPublished,
      },
      'Warm worker pool scan completed'
    );
  }
}
