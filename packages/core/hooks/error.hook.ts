import {
  FastifyRequest,
  FastifyReply,
  HookHandlerDoneFunction,
  FastifyError,
} from 'fastify';
import { LoggerService } from '@core/services/logger.service';
import { container } from 'tsyringe';
import { EDocumentation } from '@core/common/enums/EDocumentation';

export const errorHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  error: FastifyError,
  done: HookHandlerDoneFunction
) => {
  const logger = container.resolve(LoggerService);

  if (
    request.raw?.url?.startsWith(EDocumentation.scalar) ||
    request.raw?.url?.startsWith(EDocumentation.swagger)
  ) {
    return done();
  }

  const responseBody = typeof error === 'string' ? JSON.parse(error) : error;
  const { keyapi } = request.headers;

  logger.error({ type: 'ERROR', keyapi, response: responseBody }, request.id);

  done();
};
