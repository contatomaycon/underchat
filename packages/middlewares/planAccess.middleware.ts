import type { FastifyReply, FastifyRequest } from 'fastify';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { setPlanActiveHeader } from '@core/common/functions/setPlanActiveHeader';

export const planGuard = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  if (request.tokenJwtData?.plan_is_active === true) return;

  return sendResponse(reply, {
    message: request.t('plan_expired_alert'),
    httpStatusCode: EHTTPStatusCode.payment_required,
  });
};

export const planStatus = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  setPlanActiveHeader(reply, request.tokenJwtData?.plan_is_active === true);
};
