import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { baileysEnvironment } from '@core/config/environments';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';

const RETRY_DELAY = 10000;
let mismatchedStatusSent = false;

const updateWorkerMismatchedStatus = async (
  workerId: string,
  accountId: string
): Promise<void> => {
  if (mismatchedStatusSent) {
    return;
  }

  try {
    const streamProducerService = container.resolve(StreamProducerService);
    const kafkaServiceQueueService = container.resolve(
      KafkaServiceQueueService
    );

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: EWorkerStatus.mismatched,
    };

    await streamProducerService.send(
      kafkaServiceQueueService.workerStatus(),
      dataPublish,
      workerId
    );

    mismatchedStatusSent = true;
  } catch (error) {
    console.error('Error updating worker mismatched status:', error);
  }
};

const ensureConnected = async (
  attempt: number,
  log: FastifyInstance['log'],
  baileys: BaileysService
): Promise<void> => {
  if (baileys.isConnected()) {
    log.info({ attempt }, 'Baileys conectado com sucesso');
    mismatchedStatusSent = false;

    return;
  }

  const currentStatus = baileys.getStatus();
  if (currentStatus === EBaileysConnectionStatus.connecting) {
    log.warn(
      { attempt },
      'Baileys aguardando pareamento. Escaneie o QR Code ou aguarde a autorização.'
    );

    await updateWorkerMismatchedStatus(
      baileysEnvironment.baileysWorkerId,
      baileysEnvironment.baileysAccountId
    );

    setTimeout(() => ensureConnected(attempt, log, baileys), RETRY_DELAY);
    return;
  }

  try {
    const state = await baileys.connect({ initial_connection: true });
    log.info(
      { status: state.status, attempt },
      'Baileys connection attempt finalizada'
    );

    if (
      state.status === EBaileysConnectionStatus.connected &&
      baileys.isConnected()
    ) {
      log.info('Baileys conectado com sucesso');
      mismatchedStatusSent = false;
      return;
    }

    setTimeout(() => ensureConnected(attempt + 1, log, baileys), RETRY_DELAY);
  } catch (error) {
    log.error({ err: error, attempt }, 'Baileys connection attempt failed');
    setTimeout(() => ensureConnected(attempt + 1, log, baileys), RETRY_DELAY);
  }
};

const baileysReadyHook = fp(async (fastify) => {
  fastify.addHook('onReady', () => {
    const baileysService = container.resolve(BaileysService);
    ensureConnected(1, fastify.log, baileysService);
  });
});

export default baileysReadyHook;
