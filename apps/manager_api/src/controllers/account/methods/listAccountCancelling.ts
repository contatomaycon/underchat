import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAccountCancellingRequest } from '@core/schema/account/listAccountCancelling/request.schema';
import { AccountCancellingListerUseCase } from '@core/useCases/account/AccountCancellingLister.useCase';

export const listAccountCancelling = async (
  request: FastifyRequest<{
    Querystring: ListAccountCancellingRequest;
  }>,
  reply: FastifyReply
) => {
  const accountCancellingListerUseCase = container.resolve(
    AccountCancellingListerUseCase
  );
  const { t } = request;

  try {
    const response = await accountCancellingListerUseCase.execute(
      request.query
    );

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
