import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { sendResponse } from '@core/common/functions/sendResponse';
import { AccountService } from '@core/services/account.service';

export const planProductGuard = (planProductId: EPlanProduct) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = request.tokenJwtData?.account_id;

    if (!accountId) {
      return sendResponse(reply, {
        message: request.t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    const accountService = container.resolve(AccountService);
    const productIds = await accountService.listActivePlanProductIds(accountId);

    if (productIds.includes(planProductId)) {
      return;
    }

    return sendResponse(reply, {
      message: request.t('internal_chat_not_available'),
      httpStatusCode: EHTTPStatusCode.payment_required,
    });
  };
};
