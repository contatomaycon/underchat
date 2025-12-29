import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAccountTestsRequest } from '@core/schema/account/listAccountTests/request.schema';
import { AccountTestsListerUseCase } from '@core/useCases/account/AccountTestsLister.useCase';

export const listAccountTests = async (
  request: FastifyRequest<{
    Querystring: ListAccountTestsRequest;
  }>,
  reply: FastifyReply
) => {
  const accountTestsListerUseCase = container.resolve(
    AccountTestsListerUseCase
  );
  const { t } = request;

  try {
    const response = await accountTestsListerUseCase.execute(request.query);

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
