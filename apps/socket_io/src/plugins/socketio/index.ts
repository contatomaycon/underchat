import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { IMessagePayload } from '@core/common/interfaces/IMessagePayload';

const socketioPlugin = async (fastify: FastifyInstance) => {
  const io = new Server(fastify.server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
    },
  });

  const pubClient = fastify.redis;
  const subClient = pubClient.duplicate();

  io.adapter(createAdapter(pubClient, subClient));

  io.on('connection', (socket: Socket) => {
    socket.on('joinRoom', (room: string) => {
      socket.join(room);
    });

    socket.on('message', (payload: IMessagePayload) => {
      const { room, message } = payload;

      io.to(room).emit('message', { from: socket.id, message });
    });

    socket.on('disconnect', () => {
      fastify.log.info(`socket ${socket.id} disconnected`);
    });
  });
};

export default fp(socketioPlugin, { name: 'socketio-plugin' });
