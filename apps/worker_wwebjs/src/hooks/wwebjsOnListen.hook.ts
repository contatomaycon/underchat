import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import {
  WwebjsService,
  setQrCodeResetCallback,
  setConnectionEstablishedCallback,
} from '@core/services/wwebjs';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { wwebjsEnvironment } from '@core/config/environments';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { QrCodeCounter } from './qrCodeCounter';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';

const RETRY_DELAY = 10000;
const RECONNECT_CHECK_DELAY = 2000;
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
        () => reject(new Error(`Wwebjs connect timeout após ${ms}ms`)),
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
  wwebjsStatus: EBaileysConnectionStatus = EBaileysConnectionStatus.info
): Promise<boolean> => {
  const balanceWorkerStatusGrpcClientService = container.resolve(
    BalanceWorkerStatusGrpcClientService
  );

  const wwebjsService = container.resolve(WwebjsService);
  const phone =
    workerStatusId === EWorkerStatus.online
      ? getPhoneNumber(wwebjsService.socket?.info?.wid?._serialized)
      : undefined;

  const dataPublish: IBaileysConnectionState = {
    code: ECodeMessage.info,
    status: wwebjsStatus,
    worker_id: workerId,
    account_id: accountId,
    worker_status_id: workerStatusId,
    phone,
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
  wwebjsStatus: EBaileysConnectionStatus
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
      wwebjsStatus
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
  wwebjsStatus: EBaileysConnectionStatus = EBaileysConnectionStatus.info
): Promise<void> => {
  const success = await notifyWorkerStatusViaGrpc(
    workerId,
    accountId,
    workerStatusId,
    log,
    wwebjsStatus
  );

  if (!success) {
    scheduleStatusRetry(workerId, accountId, workerStatusId, log, wwebjsStatus);
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
  wwebjs: WwebjsService,
  onReady?: () => void
): Promise<void> => {
  log.info(
    { attempt, qrCodeCount: QrCodeCounter.getCount() },
    'Wwebjs: iniciando verificação de conexão'
  );

  if (wwebjs.isConnected()) {
    log.info({ attempt }, 'Wwebjs conectado com sucesso');
    mismatchedStatusSent = false;
    QrCodeCounter.reset();
    await notifyAndEnsureDelivery(
      wwebjsEnvironment.wwebjsWorkerId,
      wwebjsEnvironment.wwebjsAccountId,
      EWorkerStatus.online,
      log,
      EBaileysConnectionStatus.connected
    );
    fireOnReady(onReady);
    ensureConnectedLock = false;

    return;
  }

  const currentStatus = wwebjs.getStatus();
  const hasValidSession = wwebjs.hasSession();

  if (
    !hasValidSession &&
    currentStatus !== EBaileysConnectionStatus.connecting
  ) {
    log.info(
      { attempt },
      'Wwebjs sem sessão restaurável. Aguardando solicitação do frontend para iniciar leitura de QR.'
    );
    QrCodeCounter.reset();
    await notifyAndEnsureDelivery(
      wwebjsEnvironment.wwebjsWorkerId,
      wwebjsEnvironment.wwebjsAccountId,
      EWorkerStatus.disponible,
      log
    );
    fireOnReady(onReady);
    ensureConnectedLock = false;
    return;
  }

  if (currentStatus === EBaileysConnectionStatus.connecting) {
    if (hasValidSession && attempt <= MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, maxRetries: MAX_RETRY_ATTEMPTS },
        'Wwebjs em estado connecting com sessão válida. Aguardando reconexão automática...'
      );
      setTimeout(
        () => ensureConnectedInner(attempt + 1, log, wwebjs, onReady),
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
        'Wwebjs: limite de gerações de QR Code atingido. Aguardando solicitação do usuário.'
      );

      await updateWorkerMismatchedStatus(
        wwebjsEnvironment.wwebjsWorkerId,
        wwebjsEnvironment.wwebjsAccountId,
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
      'Wwebjs aguardando pareamento. Escaneie o QR Code ou aguarde a autorização.'
    );

    fireOnReady(onReady);

    setTimeout(() => ensureConnectedInner(attempt, log, wwebjs), RETRY_DELAY);
    return;
  }

  log.info({ attempt }, 'Wwebjs: iniciando tentativa de conexão');

  try {
    const state = await withConnectTimeout(
      wwebjs.connect({ initial_connection: true }),
      CONNECT_TIMEOUT_MS
    );
    log.info(
      { status: state.status, attempt },
      'Wwebjs connection attempt finalizada'
    );

    if (
      state.status === EBaileysConnectionStatus.connected &&
      wwebjs.isConnected()
    ) {
      log.info('Wwebjs conectado com sucesso');
      mismatchedStatusSent = false;
      QrCodeCounter.reset();
      await notifyAndEnsureDelivery(
        wwebjsEnvironment.wwebjsWorkerId,
        wwebjsEnvironment.wwebjsAccountId,
        EWorkerStatus.online,
        log,
        EBaileysConnectionStatus.connected
      );
      fireOnReady(onReady);
      ensureConnectedLock = false;
      return;
    }

    const delay =
      state.status === EBaileysConnectionStatus.connecting
        ? RECONNECT_CHECK_DELAY
        : RETRY_DELAY;
    setTimeout(
      () => ensureConnectedInner(attempt + 1, log, wwebjs, onReady),
      delay
    );
  } catch (error) {
    const hasValidSession = wwebjs.hasSession();
    log.error(
      { err: error, attempt, hasSession: hasValidSession },
      'Wwebjs connection attempt failed'
    );

    if (hasValidSession && attempt < MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, nextAttempt: attempt + 1, maxRetries: MAX_RETRY_ATTEMPTS },
        'Wwebjs: sessão válida encontrada, tentando reconexão...'
      );
      wwebjs.reconnect({ initial_connection: true });
      setTimeout(
        () => ensureConnectedInner(attempt + 1, log, wwebjs, onReady),
        RETRY_DELAY
      );
    } else if (attempt < MAX_RETRY_ATTEMPTS) {
      log.info(
        { attempt, nextAttempt: attempt + 1 },
        'Wwebjs: tentando nova conexão...'
      );
      setTimeout(
        () => ensureConnectedInner(attempt + 1, log, wwebjs, onReady),
        RETRY_DELAY
      );
    } else {
      log.error(
        { attempt, maxRetries: MAX_RETRY_ATTEMPTS },
        'Wwebjs: máximo de tentativas atingido, aguardando QR code'
      );
      QrCodeCounter.reset();
      await notifyAndEnsureDelivery(
        wwebjsEnvironment.wwebjsWorkerId,
        wwebjsEnvironment.wwebjsAccountId,
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
  wwebjs: WwebjsService,
  onReady?: () => void
): Promise<void> => {
  if (ensureConnectedLock) {
    log.info('ensureConnected já em execução, ignorando chamada concorrente');
    fireOnReady(onReady);
    return;
  }
  ensureConnectedLock = true;
  return ensureConnectedInner(attempt, log, wwebjs, onReady);
};

const wwebjsOnListenHook = fp(async (fastify) => {
  fastify.decorate('wwebjsInitialized', undefined as unknown as Promise<void>);

  setQrCodeResetCallback(() => {
    QrCodeCounter.reset();
  });

  setConnectionEstablishedCallback(async () => {
    try {
      fastify.log.info(
        'Wwebjs: nova conexão estabelecida, iniciando ensureConnected...'
      );
      const wwebjsService = container.resolve(WwebjsService);
      QrCodeCounter.reset();
      mismatchedStatusSent = false;

      ensureConnectedLock = false;
      await ensureConnected(1, fastify.log, wwebjsService);

      fastify.log.info(
        'Wwebjs: ensureConnected executado com sucesso após nova conexão'
      );
    } catch (err) {
      fastify.log.error(
        { err },
        'Wwebjs: erro ao processar nova conexão estabelecida'
      );
    }
  });

  fastify.addHook('onListen', () => {
    try {
      const wwebjsService = container.resolve(WwebjsService);
      QrCodeCounter.reset();

      fastify.wwebjsInitialized = new Promise<void>((resolve) => {
        ensureConnected(1, fastify.log, wwebjsService, resolve).catch(
          (err: unknown) => {
            fastify.log.error(
              { err },
              'Wwebjs ensureConnected falhou inesperadamente'
            );
            resolve();
          }
        );
      });
    } catch (err) {
      fastify.log.error(
        { err },
        'Wwebjs: falha ao iniciar verificação de conexão no onListen'
      );
    }
  });

  fastify.addHook('onClose', async () => {
    try {
      const wwebjsService = container.resolve(WwebjsService);
      await wwebjsService.shutdown();
    } catch (err) {
      fastify.log.error({ err }, 'Wwebjs: erro ao encerrar conexão no onClose');
    }
  });
});

export default wwebjsOnListenHook;
export { QrCodeCounter };
