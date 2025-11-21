import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAccountRequest } from '@core/schema/account/listAccount/request.schema';
import { AccountListerUseCase } from '@core/useCases/account/AccountLister.useCase';

export const listAccount = async (
  request: FastifyRequest<{
    Querystring: ListAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const accountListerUseCase = container.resolve(AccountListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await accountListerUseCase.execute(
      t,
      request.query,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('account_list_not_found'),
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
