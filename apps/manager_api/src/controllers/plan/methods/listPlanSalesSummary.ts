import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { PlanSalesSummaryListerUseCase } from '@core/useCases/plan/PlanSalesSummaryLister.useCase';

export const listPlanSalesSummary = async (
  request: FastifyRequest<{
    Querystring: ListPlanSalesRequest;
  }>,
  reply: FastifyReply
) => {
  const planSalesSummaryListerUseCase = container.resolve(
    PlanSalesSummaryListerUseCase
  );
  const { t } = request;

  try {
    const response = await planSalesSummaryListerUseCase.execute(
      t,
      request.query
    );

    if (response) {
      return sendResponse(reply, {
        message: t('plan_sales_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('plan_sales_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
