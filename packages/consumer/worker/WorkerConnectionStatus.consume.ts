import { singleton } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

@singleton()
export class WorkerConnectionStatusConsume {
  private connectionRetryTimer: NodeJS.Timeout | null = null;
  private connectionRetryAttempt = 0;
  private readonly connectionRetryIntervalMs = 15_000;
  private readonly connectionRetryMinAttempts = 10;
  private activeConnectionRequest: StatusConnectionWorkerRequest | null = null;

  constructor(
    private readonly baileysService: BaileysService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  requestConnection(payload: StatusConnectionWorkerRequest): void {
    void this.handleConnectionStatus(payload);
  }

  async close(): Promise<void> {
    this.stopConnectionRetry();
  }

  private async handleConnectionStatus(
    data: StatusConnectionWorkerRequest
  ): Promise<void> {
    if (data.status === EWorkerStatus.online) {
      await this.handleOnline(data);

      return;
    }

    if (data.status === EWorkerStatus.recreating) {
      this.handleRecreating();

      return;
    }

    if (data.status === EWorkerStatus.disponible) {
      await this.handleDisponible();
    }
  }

  private async handleOnline(
    data: StatusConnectionWorkerRequest
  ): Promise<void> {
    this.startConnectionRetry(data);
  }

  private handleRecreating(): void {
    this.baileysService.reconnect({ initial_connection: true });
  }

  private async handleDisponible(): Promise<void> {
    this.stopConnectionRetry();
    await this.baileysService.disconnect({
      initial_connection: true,
      disconnected_user: true,
    });

    const workerId = baileysEnvironment.baileysWorkerId;
    const accountId = baileysEnvironment.baileysAccountId;

    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.disconnected,
      worker_id: workerId,
      account_id: accountId,
      code: ECodeMessage.connectionClosed,
      disconnected_user: true,
      worker_status_id: EWorkerStatus.disponible,
    };

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.workerStatus(),
      payload,
      workerId
    );
  }

  private startConnectionRetry(data: StatusConnectionWorkerRequest): void {
    this.stopConnectionRetry();
    this.activeConnectionRequest = data;
    this.connectionRetryAttempt = 0;
    this.runConnectionAttempt();
  }

  private stopConnectionRetry(): void {
    if (this.connectionRetryTimer) {
      clearTimeout(this.connectionRetryTimer);
      this.connectionRetryTimer = null;
    }
    this.activeConnectionRequest = null;
    this.connectionRetryAttempt = 0;
  }

  private scheduleNextAttempt(): void {
    if (!this.activeConnectionRequest) {
      return;
    }

    this.connectionRetryTimer = setTimeout(() => {
      this.runConnectionAttempt();
    }, this.connectionRetryIntervalMs);
  }

  private publishConnectionAttempt(attempt: number): void {
    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      attempt,
      max_attempts: this.connectionRetryMinAttempts,
    };

    void this.centrifugoService
      .publishSub(workerCentrifugoQueue(payload.account_id), payload)
      .catch(() => {});
  }

  private async runConnectionAttempt(): Promise<void> {
    const request = this.activeConnectionRequest;
    if (!request) {
      return;
    }

    if (this.baileysService.isConnected()) {
      this.stopConnectionRetry();
      return;
    }

    this.baileysService.abortConnectionAttempt('new_connection_request');

    this.connectionRetryAttempt += 1;
    this.publishConnectionAttempt(this.connectionRetryAttempt);

    if (this.connectionRetryAttempt > this.connectionRetryMinAttempts) {
      this.stopConnectionRetry();
      this.baileysService.abortConnectionAttempt('max_retries_exceeded');
      void this.baileysService
        .disconnect({
          initial_connection: true,
          disconnected_user: true,
        })
        .catch((error) => {
          console.error('Error disconnecting Baileys after retries:', error);
        });
      return;
    }

    const connectPromise = this.baileysService
      .connect({
        initial_connection: true,
        type: request.type as EBaileysConnectionType,
        phone_connection: request.phone_connection,
      })
      .then((state) => {
        if (
          state?.qrcode ||
          state?.status === EBaileysConnectionStatus.connected
        ) {
          this.stopConnectionRetry();
        }
      })
      .catch((error) => {
        console.error('Error initiating Baileys connection:', error);
      });

    void connectPromise;

    if (this.connectionRetryAttempt < this.connectionRetryMinAttempts) {
      this.scheduleNextAttempt();
    } else {
      this.connectionRetryTimer = setTimeout(() => {
        if (
          this.activeConnectionRequest &&
          !this.baileysService.isConnected()
        ) {
          this.stopConnectionRetry();
          this.baileysService.abortConnectionAttempt('max_retries_exceeded');
          void this.baileysService
            .disconnect({
              initial_connection: true,
              disconnected_user: true,
            })
            .catch((error) => {
              console.error(
                'Error disconnecting Baileys after retries:',
                error
              );
            });
        }
      }, this.connectionRetryIntervalMs);
    }
  }
}
