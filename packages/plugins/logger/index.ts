import { LoggerService } from '@core/services/logger.service';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';

const loggerServicePlugin = async (fastify: FastifyInstance) => {
  const loggerService = container.resolve(LoggerService);

  fastify.decorate('logger', loggerService);
};

export default fp(loggerServicePlugin, { name: 'logger-service-plugin' });
