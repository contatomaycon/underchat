import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAccountSubscribersRequest } from '@core/schema/account/listAccountSubscribers/request.schema';
import { AccountSubscribersListerUseCase } from '@core/useCases/account/AccountSubscribersLister.useCase';

export const listAccountSubscribers = async (
  request: FastifyRequest<{
    Querystring: ListAccountSubscribersRequest;
  }>,
  reply: FastifyReply
) => {
  const accountSubscribersListerUseCase = container.resolve(
    AccountSubscribersListerUseCase
  );
  const { t } = request;

  try {
    const response = await accountSubscribersListerUseCase.execute(
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
