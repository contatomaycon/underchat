import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditAccountInfoParamsRequest,
  EditAccountInfoRequest,
} from '@core/schema/account/editAccountInfo/request.schema';
import { AccountInfoUpdaterUseCase } from '@core/useCases/account/AccountInfoUpdater.useCase';

export const editAccountInfo = async (
  request: FastifyRequest<{
    Params: EditAccountInfoParamsRequest;
    Body: EditAccountInfoRequest;
  }>,
  reply: FastifyReply
) => {
  const accountInfoUpdaterUseCase = container.resolve(
    AccountInfoUpdaterUseCase
  );
  const { t } = request;

  try {
    const response = await accountInfoUpdaterUseCase.execute(
      t,
      request.params.account_info_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_info_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('account_info_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
