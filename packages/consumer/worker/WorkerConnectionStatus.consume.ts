import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

@singleton()
export class WorkerConnectionStatusConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private connectionRetryTimer: NodeJS.Timeout | null = null;
  private connectionRetryAttempt = 0;
  private readonly connectionRetryIntervalMs = 15_000;
  private readonly connectionRetryMinAttempts = 10;
  private activeConnectionRequest: StatusConnectionWorkerRequest | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly baileysService: BaileysService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    const t0 = Date.now();
    console.log(
      '[worker_baileys:init] WorkerConnectionStatus.consume: execute iniciado',
      { ts: t0 }
    );
    if (this.consumer && this.isRunning) {
      console.log(
        '[worker_baileys:init] WorkerConnectionStatus.consume: execute já rodando, saindo',
        { ts: Date.now() }
      );
      return;
    }

    const topic = this.getWorkerConnectionTopic();
    console.log(
      '[worker_baileys:init] WorkerConnectionStatus.consume: topic obtido',
      { topic, ts: Date.now() }
    );

    const tEnsureTopic = Date.now();
    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaBaileysQueueService.getNumPartitions(),
      this.kafkaBaileysQueueService.getReplicationFactor()
    );
    console.log(
      '[worker_baileys:init] WorkerConnectionStatus.consume: ensureKafkaTopic concluído',
      { topic, ms: Date.now() - tEnsureTopic, ts: Date.now() }
    );

    const tCreateConsumer = Date.now();
    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-worker-connection-status-${baileysEnvironment.baileysWorkerId}`
    );
    console.log(
      '[worker_baileys:init] WorkerConnectionStatus.consume: createConsumer concluído',
      { ms: Date.now() - tCreateConsumer, ts: Date.now() }
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);

        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        await this.handleConnectionStatus(data);
      } catch (error) {
        console.error('Error handling connection status:', error);
        await this.commitNext(topic, message.partition, message.offset);
      } finally {
        stop();
      }

      await this.commitNext(topic, message.partition, message.offset);
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    const tConnect = Date.now();
    console.log(
      '[worker_baileys:init] WorkerConnectionStatus.consume: connectConsumer iniciando',
      { topic, ts: Date.now() }
    );
    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
      console.log(
        '[worker_baileys:init] WorkerConnectionStatus.consume: connectConsumer callback (conectado)',
        { ms: Date.now() - tConnect, msTotal: Date.now() - t0, ts: Date.now() }
      );
    });
    console.log(
      '[worker_baileys:init] WorkerConnectionStatus.consume: execute concluído (connectConsumer assíncrono)',
      { msTotal: Date.now() - t0, ts: Date.now() }
    );
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      this.stopConnectionRetry();
      this.isRunning = false;
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }
        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
    }
  }

  private getWorkerConnectionTopic(): string {
    const topic = this.kafkaBaileysQueueService.workerConnection(
      baileysEnvironment.baileysWorkerId
    );

    return topic;
  }

  private parseMessage(
    value: Buffer | null
  ): StatusConnectionWorkerRequest | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as StatusConnectionWorkerRequest;
      return parsed ?? null;
    } catch {
      return null;
    }
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
    if (
      this.activeConnectionRequest &&
      this.isSameConnectionRequest(this.activeConnectionRequest, data)
    ) {
      return;
    }

    this.stopConnectionRetry();
    this.activeConnectionRequest = data;
    this.connectionRetryAttempt = 0;

    this.runConnectionAttempt();
  }

  private isSameConnectionRequest(
    current: StatusConnectionWorkerRequest,
    next: StatusConnectionWorkerRequest
  ): boolean {
    return (
      current.worker_id === next.worker_id &&
      current.status === next.status &&
      current.type === next.type &&
      (current.phone_connection ?? '') === (next.phone_connection ?? '')
    );
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

    this.connectionRetryAttempt += 1;
    this.publishConnectionAttempt(this.connectionRetryAttempt);

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

    this.scheduleNextAttempt();
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }
}
