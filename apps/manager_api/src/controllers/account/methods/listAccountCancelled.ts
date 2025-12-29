import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
