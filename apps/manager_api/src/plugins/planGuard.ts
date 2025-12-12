import { FastifyReply, FastifyRequest } from 'fastify';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';

export const planGuard = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const planActive = request.tokenJwtData?.plan_is_active === true;
  if (planActive) return;

  return sendResponse(reply, {
    message: request.t('plan_expired_alert'),
    httpStatusCode: EHTTPStatusCode.payment_required,
  });
};
