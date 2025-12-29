import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { PlanSalesListerUseCase } from '@core/useCases/plan/PlanSalesLister.useCase';

export const listPlanSales = async (
  request: FastifyRequest<{
    Querystring: ListPlanSalesRequest;
  }>,
  reply: FastifyReply
) => {
  const planSalesListerUseCase = container.resolve(PlanSalesListerUseCase);
  const { t } = request;

  try {
    const response = await planSalesListerUseCase.execute(t, request.query);

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
