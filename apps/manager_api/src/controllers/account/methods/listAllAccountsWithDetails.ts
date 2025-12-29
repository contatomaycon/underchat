import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAccountRequest } from '@core/schema/account/listAccount/request.schema';
import { AccountAllListerWithDetailsUseCase } from '@core/useCases/account/AccountAllListerWithDetails.useCase';

export const listAllAccountsWithDetails = async (
  request: FastifyRequest<{
    Querystring: ListAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const accountAllListerWithDetailsUseCase = container.resolve(
    AccountAllListerWithDetailsUseCase
  );
  const { t } = request;

  try {
    const response = await accountAllListerWithDetailsUseCase.execute(
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
