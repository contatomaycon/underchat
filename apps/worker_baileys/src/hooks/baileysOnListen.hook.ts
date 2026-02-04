import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import {
  BaileysService,
  setQrCodeResetCallback,
  setConnectionEstablishedCallback,
} from '@core/services/baileys';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { baileysEnvironment } from '@core/config/environments';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { QrCodeCounter } from './qrCodeCounter';

const RETRY_DELAY = 10000;
const CONNECT_TIMEOUT_MS = 60000;
const MAX_RETRY_ATTEMPTS = 5;
const STATUS_NOTIFY_MAX_RETRIES = 5;
const STATUS_NOTIFY_RETRY_DELAY_MS = 2000;
const STATUS_NOTIFY_FALLBACK_DELAY_MS = 30000;
let mismatchedStatusSent = false;
let ensureConnectedLock = false;

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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const notifyWorkerStatusViaGrpc = async (
  workerId: string,
  accountId: string,
  workerStatusId: EWorkerStatus,
  log: FastifyInstance['log'],
  baileysStatus: EBaileysConnectionStatus = EBaileysConnectionStatus.info
): Promise<boolean> => {
  const balanceWorkerStatusGrpcClientService = container.resolve(
    BalanceWorkerStatusGrpcClientService
  );

  const dataPublish: IBaileysConnectionState = {
    code: ECodeMessage.info,
    status: baileysStatus,
    worker_id: workerId,
    account_id: accountId,
    worker_status_id: workerStatusId,
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= STATUS_NOTIFY_MAX_RETRIES; attempt++) {
    try {
      await balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        dataPublish
      );
      log.info(
        { workerStatusId, workerId },
        'Status do worker notificado via gRPC com sucesso'
      );
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log.warn(
        {
          err: lastError,
          attempt,
          maxRetries: STATUS_NOTIFY_MAX_RETRIES,
        },
        'Falha ao enviar status do worker via gRPC, tentando novamente'
      );

      if (attempt < STATUS_NOTIFY_MAX_RETRIES) {
        await sleep(STATUS_NOTIFY_RETRY_DELAY_MS);
      }
    }
  }

  log.error(
    { err: lastError, maxRetries: STATUS_NOTIFY_MAX_RETRIES },
    'Falha ao enviar status do worker via gRPC após todas as tentativas'
  );
  return false;
};

const scheduleStatusRetry = (
  workerId: string,
  accountId: string,
  workerStatusId: EWorkerStatus,
  log: FastifyInstance['log'],
  baileysStatus: EBaileysConnectionStatus
): void => {
  log.warn(
    { retryDelayMs: STATUS_NOTIFY_FALLBACK_DELAY_MS },
    'Agendando re-tentativa de notificação de status via gRPC'
  );
  setTimeout(() => {
    notifyWorkerStatusViaGrpc(
      workerId,
      accountId,
      workerStatusId,
      log,
      baileysStatus
    ).catch((err) => {
      log.error(
        { err },
        'Falha na re-tentativa agendada de notificação de status via gRPC'
      );
    });
  }, STATUS_NOTIFY_FALLBACK_DELAY_MS);
};

const notifyAndEnsureDelivery = async (
  workerId: string,
  accountId: string,
  workerStatusId: EWorkerStatus,
  log: FastifyInstance['log'],
  baileysStatus: EBaileysConnectionStatus = EBaileysConnectionStatus.info
): Promise<void> => {
  const success = await notifyWorkerStatusViaGrpc(
    workerId,
    accountId,
    workerStatusId,
    log,
    baileysStatus
  );

  if (!success) {
    scheduleStatusRetry(
      workerId,
      accountId,
      workerStatusId,
      log,
      baileysStatus
    );
  }
};

const updateWorkerMismatchedStatus = async (
  workerId: string,
  accountId: string,
  log: FastifyInstance['log']
): Promise<void> => {
  if (mismatchedStatusSent) {
    return;
  }

  await notifyAndEnsureDelivery(
    workerId,
    accountId,
    EWorkerStatus.mismatched,
    log
  );
  mismatchedStatusSent = true;
};

const fireOnReady = (onReady?: () => void): void => {
  if (onReady) {
    onReady();
  }
};

const ensureConnectedInner = async (
  attempt: number,
  log: FastifyInstance['log'],
  baileys: BaileysService,
  onReady?: () => void
): Promise<void> => {
  log.info(
    { attempt, qrCodeCount: QrCodeCounter.getCount() },
    'Baileys: iniciando verificação de conexão'
  );

  if (baileys.isConnected()) {
    log.info({ attempt }, 'Baileys conectado com sucesso');
    mismatchedStatusSent = false;
    QrCodeCounter.reset();
    await notifyAndEnsureDelivery(
      baileysEnvironment.baileysWorkerId,
      baileysEnvironment.baileysAccountId,
      EWorkerStatus.online,
      log,
      EBaileysConnectionStatus.connected
    );
    fireOnReady(onReady);
    ensureConnectedLock = false;

    return;
  }

  const currentStatus = baileys.getStatus();
  if (currentStatus === EBaileysConnectionStatus.connecting) {
    const hasValidSession = baileys.hasSession();

    if (hasValidSession && attempt <= MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, maxRetries: MAX_RETRY_ATTEMPTS },
        'Baileys em estado connecting com sessão válida. Aguardando reconexão automática...'
      );
      setTimeout(
        () => ensureConnectedInner(attempt + 1, log, baileys, onReady),
        RETRY_DELAY
      );
      return;
    }

    if (QrCodeCounter.hasReachedLimit()) {
      log.warn(
        {
          qrCodeCount: QrCodeCounter.getCount(),
          maxQrCodes: QrCodeCounter.getMaxGenerations(),
        },
        'Baileys: limite de gerações de QR Code atingido. Aguardando solicitação do usuário.'
      );

      await updateWorkerMismatchedStatus(
        baileysEnvironment.baileysWorkerId,
        baileysEnvironment.baileysAccountId,
        log
      );

      fireOnReady(onReady);
      ensureConnectedLock = false;
      return;
    }

    const newCount = QrCodeCounter.increment();
    log.warn(
      {
        attempt,
        hasSession: hasValidSession,
        qrCodeCount: newCount,
      },
      'Baileys aguardando pareamento. Escaneie o QR Code ou aguarde a autorização.'
    );

    fireOnReady(onReady);

    setTimeout(() => ensureConnectedInner(attempt, log, baileys), RETRY_DELAY);
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
      QrCodeCounter.reset();
      await notifyAndEnsureDelivery(
        baileysEnvironment.baileysWorkerId,
        baileysEnvironment.baileysAccountId,
        EWorkerStatus.online,
        log,
        EBaileysConnectionStatus.connected
      );
      fireOnReady(onReady);
      ensureConnectedLock = false;
      return;
    }

    setTimeout(
      () => ensureConnectedInner(attempt + 1, log, baileys, onReady),
      RETRY_DELAY
    );
  } catch (error) {
    const hasValidSession = baileys.hasSession();
    log.error(
      { err: error, attempt, hasSession: hasValidSession },
      'Baileys connection attempt failed'
    );

    if (hasValidSession && attempt < MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, nextAttempt: attempt + 1, maxRetries: MAX_RETRY_ATTEMPTS },
        'Baileys: sessão válida encontrada, tentando reconexão...'
      );
      baileys.reconnect({ initial_connection: true });
      setTimeout(
        () => ensureConnectedInner(attempt + 1, log, baileys, onReady),
        RETRY_DELAY
      );
    } else if (attempt < MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, nextAttempt: attempt + 1 },
        'Baileys: tentando nova conexão...'
      );
      setTimeout(
        () => ensureConnectedInner(attempt + 1, log, baileys, onReady),
        RETRY_DELAY
      );
    } else {
      log.error(
        { attempt, maxRetries: MAX_RETRY_ATTEMPTS },
        'Baileys: máximo de tentativas atingido, aguardando QR code'
      );
      QrCodeCounter.reset();
      await notifyAndEnsureDelivery(
        baileysEnvironment.baileysWorkerId,
        baileysEnvironment.baileysAccountId,
        EWorkerStatus.disponible,
        log
      );
      fireOnReady(onReady);
      ensureConnectedLock = false;
    }
  }
};

const ensureConnected = async (
  attempt: number,
  log: FastifyInstance['log'],
  baileys: BaileysService,
  onReady?: () => void
): Promise<void> => {
  if (ensureConnectedLock) {
    log.info('ensureConnected já em execução, ignorando chamada concorrente');
    fireOnReady(onReady);
    return;
  }
  ensureConnectedLock = true;
  return ensureConnectedInner(attempt, log, baileys, onReady);
};

const baileysOnListenHook = fp(async (fastify) => {
  fastify.decorate('baileysInitialized', undefined as unknown as Promise<void>);

  setQrCodeResetCallback(() => {
    QrCodeCounter.reset();
  });

  setConnectionEstablishedCallback(async () => {
    try {
      fastify.log.info(
        'Baileys: nova conexão estabelecida, iniciando ensureConnected...'
      );
      const baileysService = container.resolve(BaileysService);
      QrCodeCounter.reset();
      mismatchedStatusSent = false;

      await ensureConnected(1, fastify.log, baileysService);

      fastify.log.info(
        'Baileys: ensureConnected executado com sucesso após nova conexão'
      );
    } catch (err) {
      fastify.log.error(
        { err },
        'Baileys: erro ao processar nova conexão estabelecida'
      );
    }
  });

  fastify.addHook('onListen', () => {
    try {
      const baileysService = container.resolve(BaileysService);
      QrCodeCounter.reset();

      fastify.baileysInitialized = new Promise<void>((resolve) => {
        ensureConnected(1, fastify.log, baileysService, resolve).catch(
          (err: unknown) => {
            fastify.log.error(
              { err },
              'Baileys ensureConnected falhou inesperadamente'
            );
            resolve();
          }
        );
      });
    } catch (err) {
      fastify.log.error(
        { err },
        'Baileys: falha ao iniciar verificação de conexão no onListen'
      );
    }
  });
});

export default baileysOnListenHook;
export { QrCodeCounter };
