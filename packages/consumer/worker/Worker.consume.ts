import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { WorkerService } from '@core/services/worker.service';
import { getImageWorker } from '@core/common/functions/getImageWorker';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PublishResult } from 'centrifuge';
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';
import { balanceEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { ContainerHealthService } from '@core/services/containerHealth.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import {
  workerCentrifugoQueue,
  channelsConfigCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

@singleton()
export class WorkerConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly workerService: WorkerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly containerHealthService: ContainerHealthService,
    private readonly streamProducerService: StreamProducerService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    console.log('[WorkerConsume] execute() - Iniciando execução do consumer');

    if (this.consumer && this.isRunning) {
      console.log(
        '[WorkerConsume] execute() - Consumer já está rodando, ignorando'
      );
      return;
    }

    const topic = this.getTopic();
    console.log('[WorkerConsume] execute() - Topic:', topic);

    await ensureKafkaTopic(this.kafka, topic);
    console.log('[WorkerConsume] execute() - Topic garantido');

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-worker-${balanceEnvironment.serverId}`
    );
    console.log('[WorkerConsume] execute() - Consumer criado');

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      console.log('[WorkerConsume] on(data) - Mensagem recebida:', data);

      if (!data) {
        console.log(
          '[WorkerConsume] on(data) - Dados inválidos, fazendo commit'
        );
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        console.log(
          '[WorkerConsume] on(data) - Processando mensagem, action:',
          data.action
        );
        await this.handleMessage(data);
        console.log(
          '[WorkerConsume] on(data) - Mensagem processada com sucesso'
        );
      } catch (error) {
        console.error(
          '[WorkerConsume] on(data) - Erro ao processar mensagem:',
          error
        );
        await this.commitNext(topic, message.partition, message.offset);
      } finally {
        stop();
      }

      console.log('[WorkerConsume] on(data) - Fazendo commit final');
      await this.commitNext(topic, message.partition, message.offset);
    });

    this.consumer.on('event.error', (err) => {
      console.error('[WorkerConsume] event.error - Erro no consumer:', err);
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
      console.log('[WorkerConsume] execute() - Consumer conectado e rodando');
    });
  }

  public async close(): Promise<void> {
    console.log('[WorkerConsume] close() - Iniciando fechamento do consumer');

    if (!this.consumer) {
      console.log(
        '[WorkerConsume] close() - Consumer não existe, nada para fechar'
      );
      return;
    }

    try {
      this.isRunning = false;
      console.log('[WorkerConsume] close() - Desconectando consumer');
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }
        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
      console.log('[WorkerConsume] close() - Consumer desconectado');
    } finally {
      this.consumer = null;
      console.log('[WorkerConsume] close() - Consumer fechado completamente');
    }
  }

  private getTopic(): string {
    const topic = this.kafkaBalanceQueueService.worker(
      balanceEnvironment.serverId
    );

    return topic;
  }

  private parseMessage(value: Buffer | null): IWorkerPayload | null {
    console.log('[WorkerConsume] parseMessage() - Parseando mensagem');

    if (!value) {
      console.log('[WorkerConsume] parseMessage() - Valor é null');
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      console.log('[WorkerConsume] parseMessage() - String vazia após trim');
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IWorkerPayload;
      console.log(
        '[WorkerConsume] parseMessage() - Mensagem parseada com sucesso'
      );
      return parsed ?? null;
    } catch (error) {
      console.error(
        '[WorkerConsume] parseMessage() - Erro ao fazer parse:',
        error
      );
      return null;
    }
  }

  private async handleMessage(data: IWorkerPayload): Promise<void> {
    console.log(
      '[WorkerConsume] handleMessage() - Iniciando processamento, action:',
      data.action,
      'worker_id:',
      data.worker_id
    );

    if (data.action === EWorkerAction.create) {
      console.log('[WorkerConsume] handleMessage() - Ação: CREATE');
      await this.createWorker(data);
      console.log('[WorkerConsume] handleMessage() - CREATE concluído');
      return;
    }

    if (data.action === EWorkerAction.delete) {
      console.log('[WorkerConsume] handleMessage() - Ação: DELETE');
      console.log(
        '[WorkerConsume] handleMessage() - Deletando da fila Baileys, worker_id:',
        data.worker_id
      );
      await this.kafkaBaileysQueueService.delete(data.worker_id);
      await this.deleteWorker(data);
      console.log('[WorkerConsume] handleMessage() - DELETE concluído');
      return;
    }

    if (data.action === EWorkerAction.recreate) {
      console.log('[WorkerConsume] handleMessage() - Ação: RECREATE');
      console.log(
        '[WorkerConsume] handleMessage() - Deletando da fila Baileys, worker_id:',
        data.worker_id
      );
      await this.kafkaBaileysQueueService.delete(data.worker_id);
      await this.recreateWorker(data);
      console.log('[WorkerConsume] handleMessage() - RECREATE concluído');
    }
  }

  private centrifugoPublish(
    dataPublish: IBaileysConnectionState
  ): Promise<PublishResult> {
    const channel = workerCentrifugoQueue(dataPublish.account_id);
    console.log(
      '[WorkerConsume] centrifugoPublish() - Publicando no Centrifugo',
      {
        channel,
        worker_id: dataPublish.worker_id,
        account_id: dataPublish.account_id,
        worker_status_id: dataPublish.worker_status_id,
      }
    );

    const promise = this.centrifugoService.publishSub(channel, dataPublish);

    return promise;
  }

  private async updateWorkerErrorStatus(
    workerId: string,
    accountId: string,
    action?: EWorkerAction,
    serverId?: string
  ): Promise<PublishResult> {
    console.log(
      '[WorkerConsume] updateWorkerErrorStatus() - Atualizando status para ERROR',
      {
        workerId,
        accountId,
        action,
        serverId,
      }
    );

    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.error,
    };

    console.log(
      '[WorkerConsume] updateWorkerErrorStatus() - Atualizando worker no banco'
    );
    await this.workerService.updateWorkerById(accountId, inputUpdate);
    console.log(
      '[WorkerConsume] updateWorkerErrorStatus() - Worker atualizado no banco'
    );

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: EWorkerStatus.error,
    };

    const publishPromises: Promise<PublishResult>[] = [
      this.centrifugoPublish(dataPublish),
    ];

    if (
      (action === EWorkerAction.delete || action === EWorkerAction.recreate) &&
      serverId
    ) {
      console.log(
        '[WorkerConsume] updateWorkerErrorStatus() - Publicando erro no Centrifugo para action:',
        action
      );
      const errorPayload: IWorkerPayload = {
        action,
        worker_id: workerId,
        server_id: serverId,
        account_id: accountId,
        worker_status_id: EWorkerStatus.error,
      };

      publishPromises.push(
        this.centrifugoService.publish(channelsConfigCentrifugo(), errorPayload)
      );
    }

    console.log(
      '[WorkerConsume] updateWorkerErrorStatus() - Publicando no Centrifugo'
    );
    const [result] = await Promise.all(publishPromises);
    console.log(
      '[WorkerConsume] updateWorkerErrorStatus() - Status de erro atualizado e publicado'
    );

    return result;
  }

  private async recreateWorker(data: IWorkerPayload): Promise<PublishResult> {
    console.log(
      '[WorkerConsume] recreateWorker() - Iniciando recriação do worker',
      {
        worker_id: data.worker_id,
        account_id: data.account_id,
      }
    );

    console.log('[WorkerConsume] recreateWorker() - Buscando tipo do worker');
    const viewWorkerType = await this.workerService.viewWorkerType(
      data.account_id,
      data.worker_id
    );

    if (!viewWorkerType) {
      console.error('[WorkerConsume] recreateWorker() - Worker não encontrado');
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );

      throw new Error('Worker not found');
    }

    console.log(
      '[WorkerConsume] recreateWorker() - Tipo do worker encontrado:',
      viewWorkerType.worker_type_id
    );

    console.log(
      '[WorkerConsume] recreateWorker() - Removendo container do worker'
    );
    const removed = await this.workerService.removeContainerWorker(
      data.worker_id,
      false
    );

    if (!removed) {
      console.error(
        '[WorkerConsume] recreateWorker() - Falha ao remover container'
      );
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );

      throw new Error('Worker removal failed');
    }

    console.log(
      '[WorkerConsume] recreateWorker() - Container removido com sucesso'
    );

    const workerType = viewWorkerType.worker_type_id as EWorkerType;
    const imageName = getImageWorker(workerType);
    console.log(
      '[WorkerConsume] recreateWorker() - Imagem do worker:',
      imageName,
      'tipo:',
      workerType
    );

    console.log('[WorkerConsume] recreateWorker() - Criando novo container');
    const containerId = await this.workerService.createContainerWorker(
      imageName,
      data.worker_id,
      data.account_id,
      false
    );

    if (!containerId) {
      console.error(
        '[WorkerConsume] recreateWorker() - Falha ao criar container'
      );
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );

      throw new Error('Worker creation failed');
    }

    console.log(
      '[WorkerConsume] recreateWorker() - Container criado:',
      containerId
    );

    console.log(
      '[WorkerConsume] recreateWorker() - Verificando saúde do container'
    );
    const healthy =
      await this.containerHealthService.isServiceHealthy(containerId);

    if (!healthy) {
      console.error(
        '[WorkerConsume] recreateWorker() - Container não está saudável'
      );
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error('Worker service is not healthy');
    }

    console.log('[WorkerConsume] recreateWorker() - Container está saudável');

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: workerType,
      container_id: containerId,
    };

    console.log(
      '[WorkerConsume] recreateWorker() - Atualizando worker no banco'
    );
    const updated = await this.workerService.updateWorkerById(
      data.account_id,
      inputUpdate
    );

    if (!updated) {
      console.error(
        '[WorkerConsume] recreateWorker() - Falha ao atualizar status do worker'
      );
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );

      throw new Error('Failed to update worker status');
    }

    console.log(
      '[WorkerConsume] recreateWorker() - Worker atualizado no banco'
    );

    const payload: StatusConnectionWorkerRequest = {
      worker_id: data.worker_id,
      status: EWorkerStatus.recreating,
      type: data.worker_type_id as EWorkerType,
    };

    console.log(
      '[WorkerConsume] recreateWorker() - Enviando payload para fila de conexão'
    );
    await this.streamProducerService.send(
      this.kafkaBaileysQueueService.workerConnection(data.worker_id),
      payload,
      data.worker_id
    );
    console.log('[WorkerConsume] recreateWorker() - Payload enviado');

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.disponible,
    };

    console.log('[WorkerConsume] recreateWorker() - Publicando no Centrifugo');
    const [result] = await Promise.all([
      this.centrifugoPublish(dataPublish),
      this.centrifugoService.publish(channelsConfigCentrifugo(), data),
    ]);

    console.log(
      '[WorkerConsume] recreateWorker() - Recriação concluída com sucesso'
    );
    return result;
  }

  private async deleteWorker(data: IWorkerPayload): Promise<PublishResult> {
    console.log(
      '[WorkerConsume] deleteWorker() - Iniciando exclusão do worker',
      {
        worker_id: data.worker_id,
        account_id: data.account_id,
      }
    );

    console.log(
      '[WorkerConsume] deleteWorker() - Verificando se worker existe'
    );
    const exists = await this.workerService.existsWorkerById(
      data.account_id,
      data.worker_id
    );

    if (!exists) {
      console.error('[WorkerConsume] deleteWorker() - Worker não encontrado');
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );

      throw new Error('Worker not found');
    }

    console.log(
      '[WorkerConsume] deleteWorker() - Worker encontrado, atualizando status'
    );
    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      number: null,
      container_id: null,
      connection_date: null,
    };

    await this.workerService.updateWorkerById(data.account_id, inputUpdate);
    console.log('[WorkerConsume] deleteWorker() - Status atualizado');

    const payload: StatusConnectionWorkerRequest = {
      worker_id: data.worker_id,
      status: EWorkerStatus.disponible,
      type: EBaileysConnectionType.qrcode,
    };

    console.log(
      '[WorkerConsume] deleteWorker() - Enviando payload para fila de conexão'
    );
    await this.streamProducerService.send(
      this.kafkaBaileysQueueService.workerConnection(data.worker_id),
      payload,
      data.worker_id
    );
    console.log('[WorkerConsume] deleteWorker() - Payload enviado');

    console.log(
      '[WorkerConsume] deleteWorker() - Removendo container do worker'
    );
    const containerId = await this.workerService.removeContainerWorker(
      data.worker_id
    );

    if (!containerId) {
      console.error(
        '[WorkerConsume] deleteWorker() - Falha ao remover container'
      );
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );

      throw new Error('Worker removal failed');
    }

    console.log(
      '[WorkerConsume] deleteWorker() - Container removido:',
      containerId
    );

    console.log('[WorkerConsume] deleteWorker() - Deletando worker do banco');
    const deleted = await this.workerService.deleteWorkerById(
      data.account_id,
      data.worker_id
    );

    if (!deleted) {
      console.error(
        '[WorkerConsume] deleteWorker() - Falha ao deletar worker do banco'
      );
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );

      throw new Error('Failed to delete worker');
    }

    console.log('[WorkerConsume] deleteWorker() - Worker deletado do banco');

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.delete,
    };

    console.log('[WorkerConsume] deleteWorker() - Publicando no Centrifugo');
    const [result] = await Promise.all([
      this.centrifugoPublish(dataPublish),
      this.centrifugoService.publish(channelsConfigCentrifugo(), data),
    ]);

    console.log(
      '[WorkerConsume] deleteWorker() - Exclusão concluída com sucesso'
    );
    return result;
  }

  private async createWorker(data: IWorkerPayload): Promise<PublishResult> {
    console.log(
      '[WorkerConsume] createWorker() - Iniciando criação do worker',
      {
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
      }
    );

    if (!data?.worker_type_id) {
      console.error(
        '[WorkerConsume] createWorker() - Worker type ID é obrigatório'
      );
      await this.updateWorkerErrorStatus(data.worker_id, data.account_id);

      throw new Error('Worker type ID is required');
    }

    console.log(
      '[WorkerConsume] createWorker() - Atualizando status para CREATING'
    );
    const inputUpdateCreating: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.creating,
    };

    await this.workerService.updateWorkerById(
      data.account_id,
      inputUpdateCreating
    );
    console.log(
      '[WorkerConsume] createWorker() - Status atualizado para CREATING'
    );

    const dataPublishCreating: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.creating,
    };

    console.log(
      '[WorkerConsume] createWorker() - Publicando status CREATING no Centrifugo'
    );
    await this.centrifugoPublish(dataPublishCreating);

    const imageName = getImageWorker(data.worker_type_id);
    console.log(
      '[WorkerConsume] createWorker() - Imagem do worker:',
      imageName
    );

    console.log('[WorkerConsume] createWorker() - Criando container do worker');
    const containerId = await this.workerService.createContainerWorker(
      imageName,
      data.worker_id,
      data.account_id
    );

    if (!containerId) {
      console.error(
        '[WorkerConsume] createWorker() - Falha ao criar container'
      );
      await this.updateWorkerErrorStatus(data.worker_id, data.account_id);

      throw new Error('Failed to create worker container');
    }

    console.log(
      '[WorkerConsume] createWorker() - Container criado:',
      containerId
    );

    console.log(
      '[WorkerConsume] createWorker() - Verificando saúde do container'
    );
    const healthy =
      await this.containerHealthService.isServiceHealthy(containerId);

    if (!healthy) {
      console.error(
        '[WorkerConsume] createWorker() - Container não está saudável'
      );
      await this.updateWorkerErrorStatus(data.worker_id, data.account_id);

      throw new Error('Worker service is not healthy');
    }

    console.log('[WorkerConsume] createWorker() - Container está saudável');

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      container_id: containerId,
    };

    console.log(
      '[WorkerConsume] createWorker() - Atualizando status para DISPONIBLE'
    );
    const updated = await this.workerService.updateWorkerById(
      data.account_id,
      inputUpdate
    );

    if (!updated) {
      console.error(
        '[WorkerConsume] createWorker() - Falha ao atualizar status do worker'
      );
      await this.updateWorkerErrorStatus(data.worker_id, data.account_id);

      throw new Error('Failed to update worker status');
    }

    console.log(
      '[WorkerConsume] createWorker() - Status atualizado para DISPONIBLE'
    );

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.disponible,
    };

    console.log(
      '[WorkerConsume] createWorker() - Publicando status DISPONIBLE no Centrifugo'
    );
    const result = await this.centrifugoPublish(dataPublish);
    console.log(
      '[WorkerConsume] createWorker() - Criação concluída com sucesso'
    );

    return result;
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    console.log('[WorkerConsume] commitNext() - Fazendo commit', {
      topic,
      partition,
      offset: offset + 1,
    });

    this.consumerOrThrow.commitSync([
      {
        topic,
        partition,
        offset: offset + 1,
      },
    ]);

    console.log('[WorkerConsume] commitNext() - Commit realizado');
  }
}
