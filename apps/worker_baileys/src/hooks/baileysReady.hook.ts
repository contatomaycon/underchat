import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';

const RETRY_DELAY = 5000;

const ensureConnected = async (
  attempt: number,
  log: FastifyInstance['log'],
  baileys: BaileysService
): Promise<void> => {
  if (baileys.isConnected()) {
    log.info({ attempt }, 'Baileys conectado com sucesso');
    return;
  }

  const currentStatus = baileys.getStatus();
  if (currentStatus === EBaileysConnectionStatus.connecting) {
    log.warn(
      { attempt },
      'Baileys aguardando pareamento. Escaneie o QR Code ou aguarde a autorização.'
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
