import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAccountDeletedRequest } from '@core/schema/account/listAccountDeleted/request.schema';
import { AccountDeletedListerUseCase } from '@core/useCases/account/AccountDeletedLister.useCase';

export const listAccountDeleted = async (
  request: FastifyRequest<{
    Querystring: ListAccountDeletedRequest;
  }>,
  reply: FastifyReply
) => {
  const accountDeletedListerUseCase = container.resolve(
    AccountDeletedListerUseCase
  );
  const { t } = request;

  try {
    const response = await accountDeletedListerUseCase.execute(request.query);

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
