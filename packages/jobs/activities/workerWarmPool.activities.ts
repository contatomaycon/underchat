import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ConnectConfig } from 'ssh2';
import { WorkerServerListerRepository } from '@core/repositories/worker/WorkerServerLister.repository';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { WorkerWarmPoolQueueService } from '@core/services/workerWarmPoolQueue.service';
import { SshService } from '@core/services/ssh.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { workerPoolEnvironment } from '@core/config/environments';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { currentTime } from '@core/common/functions/currentTime';
import { logger } from '@core/plugins/telemetry/logger';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';

const WARM_WORKER_TYPES = [
  EWorkerType.baileys,
  EWorkerType.wwebjs,
  EWorkerType.whatsmeow,
];
const WARMING_STALE_AFTER_MS = 3 * 60 * 1000;

interface IRunningWarmContainer {
  name: string;
  warmPoolId?: string;
  workerTypeId?: string;
}

@injectable()
export class WorkerWarmPoolActivity {
  constructor(
    @inject(WorkerServerListerRepository)
    private readonly workerServerListerRepository: WorkerServerListerRepository,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository,
    @inject(WorkerWarmPoolQueueService)
    private readonly workerWarmPoolQueueService: WorkerWarmPoolQueueService,
    @inject(SshService)
    private readonly sshService: SshService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
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
      await this.workerServerListerRepository.listWarmPoolEligibleBalanceServers();
    const target = workerPoolEnvironment.warmWorkerTargetReady;
    let replenishPublished = 0;
    let staleReconciled = 0;

    for (const server of servers) {
      staleReconciled += await this.reconcileServerWarmPool(server);

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
        stale_reconciled: staleReconciled,
        replenish_published: replenishPublished,
      },
      'Warm worker pool scan completed'
    );
  }

  private buildSshConfig(server: IBalanceMonitorServer): ConnectConfig {
    return {
      host: server.ssh_ip,
      port: server.ssh_port,
      username: this.passwordEncryptorService.decrypt(server.ssh_username),
      password: this.passwordEncryptorService.decrypt(server.ssh_password),
    };
  }

  private parseRunningWarmContainerLine(
    line: string
  ): IRunningWarmContainer | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const [rawName, rawWarmStandby, rawWarmPoolId, rawWorkerTypeId] =
      trimmed.split('|');
    const name = rawName?.trim();
    if (!name) {
      return null;
    }

    const warmStandby = rawWarmStandby?.trim().toLowerCase() === 'true';
    const warmPoolId = rawWarmPoolId?.trim();
    const workerTypeId = rawWorkerTypeId?.trim();
    const isWarmContainer =
      warmStandby || !!warmPoolId || name.startsWith('warm-');

    if (!isWarmContainer) {
      return null;
    }

    return {
      name,
      warmPoolId: warmPoolId || undefined,
      workerTypeId: workerTypeId || undefined,
    };
  }

  private async listRunningWarmContainers(
    server: IBalanceMonitorServer
  ): Promise<IRunningWarmContainer[] | null> {
    const command = `docker ps --format '{{.Names}}|{{.Label "underchat.warm_standby"}}|{{.Label "underchat.warm_pool_id"}}|{{.Label "underchat.worker_type_id"}}'`;

    try {
      const outputs = await this.sshService.runCommands(
        server.server_id,
        this.buildSshConfig(server),
        [command],
        false
      );
      const combined = outputs
        .map((item) => item.output)
        .join('\n')
        .trim();

      if (!combined) {
        return [];
      }

      return combined
        .split('\n')
        .map((line) => this.parseRunningWarmContainerLine(line))
        .filter((container): container is IRunningWarmContainer => !!container);
    } catch (error) {
      logger.warn(
        {
          type: 'warm_pool.reconcile.docker_list_error',
          server_id: server.server_id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Warm worker pool docker reconcile skipped'
      );
      return null;
    }
  }

  private getWarmPoolReference(entry: IWorkerWarmPool): {
    warmPoolId: string;
    containerName: string;
  } {
    return {
      warmPoolId: entry.warm_pool_id,
      containerName: entry.container_name || `warm-${entry.warm_pool_id}`,
    };
  }

  private isEntryVisibleInDocker(
    entry: IWorkerWarmPool,
    runningContainers: IRunningWarmContainer[]
  ): boolean {
    const reference = this.getWarmPoolReference(entry);

    return runningContainers.some(
      (container) =>
        container.warmPoolId === reference.warmPoolId ||
        container.name === reference.containerName
    );
  }

  private getEntryTimestampMs(value?: string | null): number {
    if (!value) {
      return 0;
    }

    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private shouldReconcileMissingEntry(
    entry: IWorkerWarmPool,
    nowMs: number
  ): boolean {
    if (entry.state === EWorkerWarmPoolState.ready) {
      return true;
    }

    if (entry.state === EWorkerWarmPoolState.reserved) {
      const expiresAt = this.getEntryTimestampMs(entry.reservation_expires_at);
      return expiresAt > 0 && expiresAt <= nowMs;
    }

    if (entry.state === EWorkerWarmPoolState.warming) {
      const updatedAt = this.getEntryTimestampMs(entry.updated_at);
      const createdAt = this.getEntryTimestampMs(entry.created_at);
      const lastTouchedAt = Math.max(updatedAt, createdAt);
      return (
        lastTouchedAt === 0 || nowMs - lastTouchedAt >= WARMING_STALE_AFTER_MS
      );
    }

    return false;
  }

  private async reconcileServerWarmPool(
    server: IBalanceMonitorServer
  ): Promise<number> {
    const [runningContainers, activeEntries] = await Promise.all([
      this.listRunningWarmContainers(server),
      this.workerWarmPoolRepository.listActiveByServer(server.server_id),
    ]);

    if (!runningContainers) {
      return 0;
    }

    const nowMs = Date.now();
    let reconciled = 0;

    for (const entry of activeEntries) {
      if (this.isEntryVisibleInDocker(entry, runningContainers)) {
        continue;
      }

      if (!this.shouldReconcileMissingEntry(entry, nowMs)) {
        continue;
      }

      const reference = this.getWarmPoolReference(entry);
      const marked = await this.workerWarmPoolRepository.markRuntime({
        warm_pool_id: entry.warm_pool_id,
        state: EWorkerWarmPoolState.deleting,
        last_error: 'warm_runtime_missing_in_docker',
      });

      if (!marked) {
        continue;
      }

      await this.workerWarmPoolQueueService.publishDelete({
        request_id: uuidv7(),
        warm_pool_id: entry.warm_pool_id,
        server_id: entry.server_id,
        worker_type_id: entry.worker_type_id,
        container_id: entry.container_id,
        container_name: reference.containerName,
        session_volume_name: entry.session_volume_name,
        remove_volume: true,
        reason: 'pool_reconcile',
        requested_at: currentTime(),
      });

      reconciled += 1;

      logger.warn(
        {
          type: 'warm_pool.reconcile.missing_runtime',
          server_id: entry.server_id,
          worker_type_id: entry.worker_type_id,
          warm_pool_id: entry.warm_pool_id,
          container_id: entry.container_id,
          container_name: reference.containerName,
          session_volume_name: entry.session_volume_name,
          state: entry.state,
        },
        'Warm worker pool entry missing in Docker; scheduled cleanup and replenish'
      );
    }

    return reconciled;
  }
}
