import {
  FastifyRequest,
  FastifyReply,
  RequestPayload,
  HookHandlerDoneFunction,
} from 'fastify';
import { LoggerService } from '@core/services/logger.service';
import { container } from 'tsyringe';
import { EDocumentation } from '@core/common/enums/EDocumentation';

export const responseHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  payload: RequestPayload,
  done: HookHandlerDoneFunction
) => {
  const logger = container.resolve(LoggerService);

  if (
    request.raw?.url?.startsWith(EDocumentation.scalar) ||
    request.raw?.url?.startsWith(EDocumentation.swagger)
  ) {
    return done();
  }

  const responseBody =
    typeof payload === 'string' ? JSON.parse(payload) : payload;

  const { keyapi } = request.headers;

  logger.info({ type: 'RESPONSE', keyapi, response: responseBody }, request.id);

  done();
};
