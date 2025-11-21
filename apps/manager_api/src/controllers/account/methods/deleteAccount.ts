import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteAccountRequest } from '@core/schema/account/deleteAccount/request.schema';
import { AccountDeleterUseCase } from '@core/useCases/account/AccountDeleter.useCase';

export const deleteAccount = async (
  request: FastifyRequest<{
    Params: DeleteAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const accountDeleterUseCase = container.resolve(AccountDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await accountDeleterUseCase.execute(
      t,
      request.params.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('account_deleter_error'),
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
