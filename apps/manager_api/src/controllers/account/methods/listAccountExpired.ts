import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAccountExpiredRequest } from '@core/schema/account/listAccountExpired/request.schema';
import { AccountExpiredListerUseCase } from '@core/useCases/account/AccountExpiredLister.useCase';

export const listAccountExpired = async (
  request: FastifyRequest<{
    Querystring: ListAccountExpiredRequest;
  }>,
  reply: FastifyReply
) => {
  const accountExpiredListerUseCase = container.resolve(
    AccountExpiredListerUseCase
  );
  const { t } = request;

  try {
    const response = await accountExpiredListerUseCase.execute(request.query);

    if (response) {
      return sendResponse(reply, {
        message: t('account_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('account_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    console.error(error);

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
