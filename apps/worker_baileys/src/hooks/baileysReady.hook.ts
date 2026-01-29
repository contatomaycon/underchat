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

const RETRY_DELAY = 15000;
const CONNECT_TIMEOUT_NEW_MS = 15000;
const CONNECT_TIMEOUT_RECONNECT_MS = 30000;
const MAX_RETRY_ATTEMPTS = 10;
let mismatchedStatusSent = false;
let isNewCreation: boolean | null = null;

const withConnectTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  console.log(
    '[worker_baileys:init] baileysReady.hook: withConnectTimeout criado',
    { ms, ts: Date.now() }
  );
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
  console.log(
    '[worker_baileys:init] baileysReady.hook: updateWorkerMismatchedStatus chamado',
    { workerId, accountId, mismatchedStatusSent, ts: Date.now() }
  );
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
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] baileysReady.hook: ensureConnected iniciado',
    { attempt, ts: t0 }
  );
  log.info({ attempt }, 'Baileys: iniciando verificação de conexão');

  if (attempt > MAX_RETRY_ATTEMPTS) {
    log.warn(
      { attempt, maxRetries: MAX_RETRY_ATTEMPTS },
      'Baileys: máximo de tentativas atingido, encerrando tentativa'
    );
    baileys.abortConnectionAttempt();
    return;
  }

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
    console.log(
      '[worker_baileys:init] baileysReady.hook: ensureConnected já conectado, saindo',
      { attempt, ms: Date.now() - t0, ts: Date.now() }
    );
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

    baileys.abortConnectionAttempt();

    setTimeout(() => ensureConnected(attempt + 1, log, baileys), RETRY_DELAY);
    return;
  }

  const timeoutMs = isNewCreation
    ? CONNECT_TIMEOUT_NEW_MS
    : CONNECT_TIMEOUT_RECONNECT_MS;
  console.log(
    '[worker_baileys:init] baileysReady.hook: ensureConnected chamando baileys.connect',
    {
      attempt,
      timeoutMs,
      isNewCreation,
      msDesdeInicio: Date.now() - t0,
      ts: Date.now(),
    }
  );
  log.info({ attempt, timeoutMs }, 'Baileys: iniciando tentativa de conexão');

  try {
    const tConnect = Date.now();
    const state = await withConnectTimeout(
      baileys.connect({ initial_connection: true }),
      timeoutMs
    );
    console.log(
      '[worker_baileys:init] baileysReady.hook: baileys.connect retornou',
      {
        status: state.status,
        attempt,
        msConnect: Date.now() - tConnect,
        msTotal: Date.now() - t0,
        ts: Date.now(),
      }
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

    if (state.status === EBaileysConnectionStatus.connecting) {
      if (state.qrcode) {
        log.info(
          { attempt },
          'Baileys: QR code emitido com sucesso. Aguardando scan do usuário.'
        );
        baileys.abortConnectionAttempt();

        setTimeout(
          () => ensureConnected(attempt + 1, log, baileys),
          RETRY_DELAY
        );
        return;
      }

      const hasValidSession = baileys.hasSession();

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

    baileys.abortConnectionAttempt();

    const isTimeout =
      error instanceof Error && error.message.toLowerCase().includes('timeout');
    const nextDelay = isTimeout ? 0 : RETRY_DELAY;

    if (!isNewCreation && hasValidSession && attempt < MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, nextAttempt: attempt + 1, maxRetries: MAX_RETRY_ATTEMPTS },
        'Baileys: sessão válida encontrada, tentando reconexão...'
      );
      baileys.reconnect({ initial_connection: true });
      setTimeout(() => ensureConnected(attempt + 1, log, baileys), nextDelay);
    } else if (attempt < MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, nextAttempt: attempt + 1 },
        'Baileys: tentando nova conexão...'
      );
      setTimeout(() => ensureConnected(attempt + 1, log, baileys), nextDelay);
    } else {
      log.error(
        { attempt, maxRetries: MAX_RETRY_ATTEMPTS },
        'Baileys: máximo de tentativas atingido, continuando retries'
      );
      setTimeout(() => ensureConnected(attempt + 1, log, baileys), nextDelay);
    }
  }
};

const baileysReadyHook = fp(async (fastify) => {
  console.log(
    '[worker_baileys:init] baileysReady.hook: plugin registrando onReady',
    { ts: Date.now() }
  );
  fastify.addHook('onReady', () => {
    const t0 = Date.now();
    console.log('[worker_baileys:init] baileysReady.hook: onReady disparado', {
      ts: t0,
    });
    try {
      const tResolve = Date.now();
      const baileysService = container.resolve(BaileysService);
      console.log(
        '[worker_baileys:init] baileysReady.hook: BaileysService resolvido',
        { ms: Date.now() - tResolve, ts: Date.now() }
      );
      ensureConnected(1, fastify.log, baileysService).catch((err: unknown) => {
        fastify.log.error(
          { err },
          'Baileys ensureConnected falhou inesperadamente'
        );
      });
      console.log(
        '[worker_baileys:init] baileysReady.hook: ensureConnected agendado (async)',
        { ms: Date.now() - t0, ts: Date.now() }
      );
    } catch (err) {
      console.log('[worker_baileys:init] baileysReady.hook: erro no onReady', {
        err,
        ts: Date.now(),
      });
      fastify.log.error(
        { err },
        'Baileys: falha ao iniciar verificação de conexão no onReady'
      );
    }
  });
  console.log(
    '[worker_baileys:init] baileysReady.hook: plugin registro concluído',
    { ts: Date.now() }
  );
});

export default baileysReadyHook;
