import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteAccountInfoRequest } from '@core/schema/account/deleteAccountInfo/request.schema';
import { AccountInfoDeleterUseCase } from '@core/useCases/account/AccountInfoDeleter.useCase';

export const deleteAccountInfo = async (
  request: FastifyRequest<{
    Params: DeleteAccountInfoRequest;
  }>,
  reply: FastifyReply
) => {
  const accountInfoDeleterUseCase = container.resolve(
    AccountInfoDeleterUseCase
  );
  const { t } = request;

  try {
    const response = await accountInfoDeleterUseCase.execute(
      t,
      request.params.account_info_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_info_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('account_info_deleter_error'),
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
