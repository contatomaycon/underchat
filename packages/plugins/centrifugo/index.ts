import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { centrifugoEnvironment } from '@core/config/environments';
import jwt from 'jsonwebtoken';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { Centrifuge, UnauthorizedError, State } from 'centrifuge';
import WebSocket from 'ws';
import { captureException } from '@core/plugins/telemetry/sentry';

interface CentrifugoPluginOptions {
  module: ERouteModule;
}

const centrifugoPlugin: FastifyPluginAsync<CentrifugoPluginOptions> = async (
  fastify: FastifyInstance,
  opts
) => {
  const module = opts.module;

  let errorHandler: ((error: unknown) => void) | null = null;
  let isShuttingDown = false;

  const generateToken = async (): Promise<string> => {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    return jwt.sign(
      { sub: module, exp },
      centrifugoEnvironment.centrifugoHmacSecretKey,
      { algorithm: 'HS256' }
    );
  };

  const getToken = async (): Promise<string> => {
    try {
      return await generateToken();
    } catch {
      throw new UnauthorizedError('Failed to generate token');
    }
  };

  const token = await generateToken();
  const client = new Centrifuge(
    `${centrifugoEnvironment.centrifugoWsUrl}/connection/websocket`,
    {
      websocket: WebSocket,
      token: token,
      getToken,
      timeout: 30_000,
      maxServerPingDelay: 60_000,
    }
  );

  errorHandler = (error: unknown) => {
    if (isShuttingDown) {
      return;
    }

    fastify.log.error(
      {
        err: error,
        type: 'centrifugo_error',
      },
      'Centrifugo client error'
    );

    captureException(error, {
      centrifugo: {
        type: 'connection_error',
      },
    });
  };

  client.on('error', errorHandler);

  await new Promise((resolve) => setImmediate(resolve));

  if (!isShuttingDown) {
    client.connect();
  }

  container.register<Centrifuge>('Centrifuge', { useValue: client });
  fastify.decorate('Centrifuge', client);

  const cleanup = async (): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    try {
      if (errorHandler) {
        client.off('error', errorHandler);
      }

      if (client.state !== State.Disconnected) {
        client.disconnect();
      }
    } catch (error) {
      fastify.log.warn({ err: error }, 'Error during Centrifugo cleanup');
    }
  };

  fastify.addHook('onClose', cleanup);

  const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
  for (const signal of signals) {
    process.once(signal, cleanup);
  }
};

export default fp(centrifugoPlugin, { name: 'centrifugo-plugin' });
