import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { centrifugoEnvironment } from '@core/config/environments';
import jwt from 'jsonwebtoken';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { Centrifuge, UnauthorizedError } from 'centrifuge';
import WebSocket from 'ws';

const centrifugoPlugin = async (fastify: FastifyInstance) => {
  const generateToken = async (): Promise<string> => {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60;
    return jwt.sign(
      { sub: ERouteModule.service, exp },
      centrifugoEnvironment.centrifugoHmacSecretKey,
      { algorithm: 'HS256' }
    );
  };

  const getToken = async () => {
    try {
      return generateToken();
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
