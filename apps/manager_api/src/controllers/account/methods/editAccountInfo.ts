import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditAccountInfoParamsRequest,
  EditAccountInfoResponse,
} from '@core/schema/account/editAccountInfo/request.schema';
import { AccountInfoUpdaterUseCase } from '@core/useCases/account/AccountInfoUpdater.useCase';

export const editAccountInfo = async (
  request: FastifyRequest<{
    Params: EditAccountInfoParamsRequest;
    Body: EditAccountInfoResponse;
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

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('account_info_update_error'),
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
