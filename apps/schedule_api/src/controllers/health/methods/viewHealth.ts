import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { BalanceImageRolloutService } from '@core/services/balanceImageRollout.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const viewHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const balanceImageRollout = container
    .resolve(BalanceImageRolloutService)
    .getStatus();

  return sendResponse(reply, {
    httpStatusCode: EHTTPStatusCode.ok,
    data: {
      balance_image_rollout: balanceImageRollout,
    },
  });
};
