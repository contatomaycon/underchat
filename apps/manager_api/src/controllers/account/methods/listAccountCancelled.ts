import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAccountCancelledRequest } from '@core/schema/account/listAccountCancelled/request.schema';
import { AccountCancelledListerUseCase } from '@core/useCases/account/AccountCancelledLister.useCase';

export const listAccountCancelled = async (
  request: FastifyRequest<{
    Querystring: ListAccountCancelledRequest;
  }>,
  reply: FastifyReply
) => {
  const accountCancelledListerUseCase = container.resolve(
    AccountCancelledListerUseCase
  );
  const { t } = request;

  try {
    const response = await accountCancelledListerUseCase.execute(request.query);

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
