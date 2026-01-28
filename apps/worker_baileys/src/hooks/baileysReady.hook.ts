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
const CONNECT_TIMEOUT_MS = 60000;
const MAX_RETRY_ATTEMPTS = 5;
let mismatchedStatusSent = false;
let isNewCreation: boolean | null = null;

const withConnectTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Baileys connect timeout após ${ms}ms`)),
        ms
      )
    ),
  ]);
};

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
  log.info({ attempt }, 'Baileys: iniciando verificação de conexão');

  if (isNewCreation === null) {
    isNewCreation = !baileys.hasSession();
    log.info(
      { isNewCreation },
      isNewCreation
        ? 'Baileys: criação nova detectada, mostrando QR code imediatamente'
        : 'Baileys: sessão existente detectada, tentando reconexão'
    );
  }

  if (baileys.isConnected()) {
    log.info({ attempt }, 'Baileys conectado com sucesso');
    mismatchedStatusSent = false;

    return;
  }

  const currentStatus = baileys.getStatus();
  if (currentStatus === EBaileysConnectionStatus.connecting) {
    const hasValidSession = baileys.hasSession();

    if (!isNewCreation && hasValidSession && attempt <= MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, maxRetries: MAX_RETRY_ATTEMPTS },
        'Baileys em estado connecting com sessão válida. Aguardando reconexão automática...'
      );
      setTimeout(() => ensureConnected(attempt + 1, log, baileys), RETRY_DELAY);
      return;
    }

    log.warn(
      { attempt, hasSession: hasValidSession, isNewCreation },
      'Baileys aguardando pareamento. Escaneie o QR Code ou aguarde a autorização.'
    );

    await updateWorkerMismatchedStatus(
      baileysEnvironment.baileysWorkerId,
      baileysEnvironment.baileysAccountId
    );

    setTimeout(() => ensureConnected(attempt, log, baileys), RETRY_DELAY);
    return;
  }

  log.info({ attempt }, 'Baileys: iniciando tentativa de conexão');

  try {
    const state = await withConnectTimeout(
      baileys.connect({ initial_connection: true }),
      CONNECT_TIMEOUT_MS
    );
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

    // Se o status é "connecting", verifica se deve mostrar QR code
    if (state.status === EBaileysConnectionStatus.connecting) {
      const hasValidSession = baileys.hasSession();

      // Criação nova OU sem sessão válida → mostra QR code imediatamente
      if (isNewCreation || !hasValidSession) {
        log.warn(
          { attempt, hasSession: hasValidSession, isNewCreation },
          'Baileys aguardando pareamento. Escaneie o QR Code ou aguarde a autorização.'
        );

        await updateWorkerMismatchedStatus(
          baileysEnvironment.baileysWorkerId,
          baileysEnvironment.baileysAccountId
        );

        setTimeout(() => ensureConnected(attempt, log, baileys), RETRY_DELAY);
        return;
      }

      if (attempt <= MAX_RETRY_ATTEMPTS) {
        log.info(
          { attempt, maxRetries: MAX_RETRY_ATTEMPTS },
          'Baileys em estado connecting com sessão válida. Aguardando reconexão automática...'
        );
        setTimeout(
          () => ensureConnected(attempt + 1, log, baileys),
          RETRY_DELAY
        );
        return;
      }
    }

    setTimeout(() => ensureConnected(attempt + 1, log, baileys), RETRY_DELAY);
  } catch (error) {
    const hasValidSession = baileys.hasSession();
    log.error(
      { err: error, attempt, hasSession: hasValidSession, isNewCreation },
      'Baileys connection attempt failed'
    );

    if (!isNewCreation && hasValidSession && attempt < MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, nextAttempt: attempt + 1, maxRetries: MAX_RETRY_ATTEMPTS },
        'Baileys: sessão válida encontrada, tentando reconexão...'
      );
      baileys.reconnect({ initial_connection: true });
      setTimeout(() => ensureConnected(attempt + 1, log, baileys), RETRY_DELAY);
    } else if (attempt < MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, nextAttempt: attempt + 1 },
        'Baileys: tentando nova conexão...'
      );
      setTimeout(() => ensureConnected(attempt + 1, log, baileys), RETRY_DELAY);
    } else {
      log.error(
        { attempt, maxRetries: MAX_RETRY_ATTEMPTS },
        'Baileys: máximo de tentativas atingido, aguardando QR code'
      );
    }
  }
};

const baileysReadyHook = fp(async (fastify) => {
  fastify.addHook('onReady', () => {
    try {
      const baileysService = container.resolve(BaileysService);
      ensureConnected(1, fastify.log, baileysService).catch((err: unknown) => {
        fastify.log.error(
          { err },
          'Baileys ensureConnected falhou inesperadamente'
        );
      });
    } catch (err) {
      fastify.log.error(
        { err },
        'Baileys: falha ao iniciar verificação de conexão no onReady'
      );
    }
  });
});

export default baileysReadyHook;
