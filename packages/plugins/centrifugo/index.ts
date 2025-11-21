import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { centrifugoEnvironment } from '@core/config/environments';
import jwt from 'jsonwebtoken';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { Centrifuge, UnauthorizedError } from 'centrifuge';
import WebSocket from 'ws';

interface CentrifugoPluginOptions {
  module: ERouteModule;
}

const centrifugoPlugin: FastifyPluginAsync<CentrifugoPluginOptions> = async (
  fastify: FastifyInstance,
  opts
) => {
  const module = opts.module;

  const generateToken = async (): Promise<string> => {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60;
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

  client.connect();

  container.register<Centrifuge>('Centrifuge', { useValue: client });
  fastify.decorate('Centrifuge', client);

  fastify.addHook('onClose', async () => {
    client.disconnect();
  });
};

export default fp(centrifugoPlugin, { name: 'centrifugo-plugin' });
