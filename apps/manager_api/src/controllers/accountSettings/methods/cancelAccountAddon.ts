import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountAddonCancellerUseCase } from '@core/useCases/accountSettings/AccountAddonCanceller.useCase';
import { CancelAccountAddonRequest } from '@core/schema/accountSettings/cancelAccountAddon/request.schema';

export const cancelAccountAddon = async (
  request: FastifyRequest<{ Params: CancelAccountAddonRequest }>,
  reply: FastifyReply
) => {
  const accountAddonCancellerUseCase = container.resolve(
    AccountAddonCancellerUseCase
  );
  const { t, tokenJwtData, params } = request;

  try {
    const response = await accountAddonCancellerUseCase.execute(
      t,
      tokenJwtData.account_id,
      params.plan_cross_sell_account_id
    );

    return sendResponse(reply, {
      message: response.message,
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
