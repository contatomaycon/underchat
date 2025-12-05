import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanProductWithPriceListerUseCase } from '@core/useCases/plan/PlanProductWithPriceLister.useCase';

export const listPlanProductWithPrice = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const planProductWithPriceListerUseCase = container.resolve(
    PlanProductWithPriceListerUseCase
  );
  const { t } = request;

  try {
    const response = await planProductWithPriceListerUseCase.execute();

    return sendResponse(reply, {
      message: t('plan_product_with_price_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

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
