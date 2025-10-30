import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { LoggerService } from '@core/services/logger.service';
import { container } from 'tsyringe';
import { EDocumentation } from '@core/common/enums/EDocumentation';
import { ELanguage } from '@core/common/enums/ELanguage';
import { getLanguageId } from '@core/common/functions/getLanguageId';

export const requestHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
) => {
  const logger = container.resolve(LoggerService);

  if (
    request.raw?.url?.startsWith(EDocumentation.scalar) ||
    request.raw?.url?.startsWith(EDocumentation.swagger)
  ) {
    return done();
  }

  const allParams = {
    params: request.params,
    query: request.query,
    body: request.body,
  };

  const { keyapi } = request.headers;
  const { headers } = request;

  const languageCode =
    (headers['accept-language'] as ELanguage) ?? ELanguage.pt;
  const languageId = getLanguageId(languageCode);

  request.languageData = {
    code: languageCode,
    id: languageId,
  };

  logger.info({ type: 'REQUEST', keyapi, request: allParams }, request.id);

  done();
};
