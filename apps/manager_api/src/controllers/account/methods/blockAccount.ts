import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BlockAccountRequest } from '@core/schema/account/blockAccount/request.schema';
import { AccountBlockerUseCase } from '@core/useCases/account/AccountBlocker.useCase';

export const blockAccount = async (
  request: FastifyRequest<{
    Params: BlockAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const accountBlockerUseCase = container.resolve(AccountBlockerUseCase);
  const { t } = request;

  try {
    const response = await accountBlockerUseCase.execute(
      request.params.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_blocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('account_block_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
