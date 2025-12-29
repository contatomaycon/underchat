import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditAccountParamsRequest,
  UpdateAccountRequest,
} from '@core/schema/account/editAccount/request.schema';
import { AccountUpdaterUseCase } from '@core/useCases/account/AccountUpdater.useCase';

export const editAccount = async (
  request: FastifyRequest<{
    Params: EditAccountParamsRequest;
    Body: UpdateAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const accountUpdaterUseCase = container.resolve(AccountUpdaterUseCase);
  const { t } = request;

  try {
    const response = await accountUpdaterUseCase.execute(
      t,
      request.params.account_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('account_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
