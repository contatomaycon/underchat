import type { Client } from '@wwebjs/whatsapp-web.js';
import { singleton, inject } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EWppConnection } from '@core/common/enums/EWppConnection';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';

const CHANNEL = workerCentrifugoQueue(wwebjsEnvironment.wwebjsAccountId);
const WORKER = wwebjsEnvironment.wwebjsWorkerId;
const ACCOUNT = wwebjsEnvironment.wwebjsAccountId;

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;
const STATE_CHECK_TIMEOUT_MS = 10_000;

type WAState =
  | 'CONFLICT'
  | 'CONNECTED'
  | 'DEPRECATED_VERSION'
  | 'OPENING'
  | 'PAIRING'
  | 'PROXYBLOCK'
  | 'SMB_TOS_BLOCK'
  | 'TIMEOUT'
  | 'TOS_BLOCK'
  | 'UNLAUNCHED'
  | 'UNPAIRED'
  | 'UNPAIRED_IDLE';

interface HealthCheckResult {
  isHealthy: boolean;
  reason?: string;
  detectedStatus: Status;
  workerStatus: EWorkerStatus;
  waState?: WAState;
}

@singleton()
export class WwebjsHealthCheckService {
  private intervalId: NodeJS.Timeout | undefined;
  private lastKnownStatus: Status = Status.initial;
  private lastKnownWorkerStatus: EWorkerStatus = EWorkerStatus.disponible;
  private isRunning = false;
  private clientGetter: (() => Client | undefined) | undefined;
  private statusGetter: (() => Status) | undefined;
  private onStatusMismatch:
    | ((detected: Status, workerStatus: EWorkerStatus) => void)
    | undefined;

  constructor(
    @inject(CentrifugoService)
    private readonly centrifugo: CentrifugoService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService
  ) {}

  configure(options: {
    getClient: () => Client | undefined;
    getStatus: () => Status;
    onStatusMismatch?: (detected: Status, workerStatus: EWorkerStatus) => void;
  }): void {
    this.clientGetter = options.getClient;
    this.statusGetter = options.getStatus;
    this.onStatusMismatch = options.onStatusMismatch;
  }

  start(intervalMs = DEFAULT_HEALTH_CHECK_INTERVAL_MS): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.intervalId = setInterval(() => {
      void this.runHealthCheck();
    }, intervalMs);

    console.log(`[WwebjsHealthCheck] Started with interval ${intervalMs}ms`);
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.isRunning = false;
    console.log('[WwebjsHealthCheck] Stopped');
  }

  async runHealthCheck(): Promise<HealthCheckResult> {
    if (!this.clientGetter || !this.statusGetter) {
      return {
        isHealthy: false,
        reason: 'Health check not configured',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    const client = this.clientGetter();
    const reportedStatus = this.statusGetter();

    const result = await this.checkConnectivity(client, reportedStatus);

    if (
      result.detectedStatus !== this.lastKnownStatus ||
      result.workerStatus !== this.lastKnownWorkerStatus
    ) {
      console.log(
        `[WwebjsHealthCheck] Status changed: ${this.lastKnownStatus} -> ${result.detectedStatus}, worker: ${this.lastKnownWorkerStatus} -> ${result.workerStatus}`
      );

      this.lastKnownStatus = result.detectedStatus;
      this.lastKnownWorkerStatus = result.workerStatus;

      await this.notifyStatusChange(client, result);
    }

    if (reportedStatus !== result.detectedStatus && this.onStatusMismatch) {
      console.log(
        `[WwebjsHealthCheck] Mismatch detected: reported=${reportedStatus}, actual=${result.detectedStatus}`
      );
      this.onStatusMismatch(result.detectedStatus, result.workerStatus);
    }

    return result;
  }

  private async checkConnectivity(
    client: Client | undefined,
    reportedStatus: Status
  ): Promise<HealthCheckResult> {
    if (!client) {
      return {
        isHealthy: false,
        reason: 'No client instance',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    let waState: WAState | undefined;
    try {
      waState = await this.getStateWithTimeout(client);
    } catch (error) {
      return {
        isHealthy: false,
        reason: `Failed to get state: ${error instanceof Error ? error.message : String(error)}`,
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    if (!waState) {
      if (reportedStatus === Status.connecting) {
        return {
          isHealthy: true,
          reason: 'Connecting (state not yet available)',
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
        };
      }

      return {
        isHealthy: false,
        reason: 'State not available',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    const stateResult = this.mapWAStateToStatus(waState);

    if (stateResult.detectedStatus === Status.connected && !client.info) {
      return {
        isHealthy: false,
        reason: 'Connected state but no client info',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        waState,
      };
    }

    return {
      ...stateResult,
      waState,
    };
  }

  private getStateWithTimeout(client: Client): Promise<WAState | undefined> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('State check timeout'));
      }, STATE_CHECK_TIMEOUT_MS);

      client
        .getState()
        .then((state) => {
          clearTimeout(timeout);
          resolve(state as WAState | undefined);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private mapWAStateToStatus(state: WAState): HealthCheckResult {
    switch (state) {
      case 'CONNECTED':
        return {
          isHealthy: true,
          reason: 'Connected',
          detectedStatus: Status.connected,
          workerStatus: EWorkerStatus.online,
        };

      case 'OPENING':
      case 'PAIRING':
        return {
          isHealthy: true,
          reason: `State: ${state}`,
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
        };

      case 'UNPAIRED':
      case 'UNPAIRED_IDLE':
        return {
          isHealthy: false,
          reason: `Not paired: ${state}`,
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.disponible,
        };

      case 'CONFLICT':
        return {
          isHealthy: false,
          reason: 'Session conflict - another device connected',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.mismatched,
        };

      case 'DEPRECATED_VERSION':
        return {
          isHealthy: false,
          reason: 'Deprecated WhatsApp Web version',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.mismatched,
        };

      case 'TIMEOUT':
        return {
          isHealthy: false,
          reason: 'Connection timeout',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
        };

      case 'PROXYBLOCK':
      case 'TOS_BLOCK':
      case 'SMB_TOS_BLOCK':
        return {
          isHealthy: false,
          reason: `Blocked: ${state}`,
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.mismatched,
        };

      case 'UNLAUNCHED':
        return {
          isHealthy: false,
          reason: 'Client not launched',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
        };

      default:
        return {
          isHealthy: false,
          reason: `Unknown state: ${state}`,
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
        };
    }
  }

  private async notifyStatusChange(
    client: Client | undefined,
    result: HealthCheckResult
  ): Promise<void> {
    const payload: IBaileysConnectionState = {
      status: result.detectedStatus,
      worker_id: WORKER,
      account_id: ACCOUNT,
      code:
        result.detectedStatus === Status.connected
          ? ECodeMessage.connectionEstablished
          : ECodeMessage.connectionLost,
      phone: getPhoneNumber(client?.info?.wid?._serialized),
      worker_status_id: result.workerStatus,
    };

    try {
      await this.centrifugo.publishSub(CHANNEL, payload);
    } catch (error) {
      console.error('[WwebjsHealthCheck] Failed to publish status', error);
    }

    try {
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payload
      );
    } catch (error) {
      console.error(
        '[WwebjsHealthCheck] Failed to notify balance worker status',
        error
      );
    }

    const isConnected = result.detectedStatus === Status.connected;
    const phone = getPhoneNumber(client?.info?.wid?._serialized);

    await this.saveLogWppConnection({
      worker_id: WORKER,
      status: result.detectedStatus,
      code: payload.code?.toString(),
      message: result.reason ?? 'Health check status update',
      date: new Date(),
      ...(isConnected && phone ? { phone, connected_at: new Date() } : {}),
    });
  }

  private readonly saveLogWppConnection = async (
    wppLog: EWppConnection
  ): Promise<boolean> => {
    const mappings = wppConnectionMappings();
    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.wpp_connection,
      mappings
    );

    if (!result || !wppLog) {
      return false;
    }

    const documentId = buildWppConnectionDocumentId(ACCOUNT, wppLog.worker_id);

    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.wpp_connection,
      documentId,
      wppLog as unknown as Record<string, unknown>,
      { upsert: true, maxRetries: 5 }
    );

    return (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    );
  };
}
