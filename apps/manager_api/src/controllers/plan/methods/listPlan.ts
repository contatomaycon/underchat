import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListPlanRequest } from '@core/schema/plan/listPlan/request.schema';
import { PlanListerUseCase } from '@core/useCases/plan/PlanLister.useCase';

export const listPlan = async (
  request: FastifyRequest<{
    Querystring: ListPlanRequest;
  }>,
  reply: FastifyReply
) => {
  const planListerUseCase = container.resolve(PlanListerUseCase);
  const { t } = request;

  try {
    const response = await planListerUseCase.execute(t, request.query);

    if (response) {
      return sendResponse(reply, {
        message: t('plan_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('plan_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
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
