import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';

const RETRY_DELAY = 10000;
const CONNECT_TIMEOUT_MS = 60000;

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

const ensureConnected = async (
  attempt: number,
  log: FastifyInstance['log'],
  baileys: BaileysService
): Promise<void> => {
  log.info({ attempt }, 'Baileys: iniciando verificação de conexão');

  if (baileys.isConnected()) {
    log.info({ attempt }, 'Baileys conectado com sucesso');

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
