import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';

export const viewHealth = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { t } = request;

  return sendResponse(reply, {
    httpStatusCode: EHTTPStatusCode.ok,
    message: t('health_check_success'),
  });
};
