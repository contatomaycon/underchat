import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountPlanProductsListerUseCase } from '@core/useCases/accountSettings/AccountPlanProductsLister.useCase';

export const listAccountPlanProducts = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountPlanProductsListerUseCase = container.resolve(
    AccountPlanProductsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountPlanProductsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('plan_products_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
