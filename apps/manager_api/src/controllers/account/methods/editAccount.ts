import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
  const { t, tokenJwtData } = request;

  try {
    const response = await accountUpdaterUseCase.execute(
      t,
      request.params.account_id,
      request.body,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('account_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
