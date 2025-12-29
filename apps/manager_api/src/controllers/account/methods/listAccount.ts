import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
  const { t } = request;

  try {
    const response = await accountListerUseCase.execute(request.query);

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
