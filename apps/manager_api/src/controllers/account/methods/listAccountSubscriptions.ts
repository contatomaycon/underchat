import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSubscriptionsListerUseCase } from '@core/useCases/account/AccountSubscriptionsLister.useCase';
import { ListAccountSubscriptionsParamsRequest } from '@core/schema/account/listAccountSubscriptions/request.schema';

export const listAccountSubscriptions = async (
  request: FastifyRequest<{
    Params: ListAccountSubscriptionsParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const accountSubscriptionsListerUseCase = container.resolve(
    AccountSubscriptionsListerUseCase
  );
  const { t } = request;

  try {
    const response = await accountSubscriptionsListerUseCase.execute(
      t,
      request.params.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_subscriptions_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('account_subscriptions_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
