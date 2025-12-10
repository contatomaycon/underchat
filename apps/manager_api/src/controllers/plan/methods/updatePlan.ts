import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdatePlanRequest,
  UpdatePlanParamsRequest,
} from '@core/schema/plan/updatePlan/request.schema';
import { PlanUpdaterUseCase } from '@core/useCases/plan/PlanUpdater.useCase';

export const updatePlan = async (
  request: FastifyRequest<{
    Params: UpdatePlanParamsRequest;
    Body: UpdatePlanRequest;
  }>,
  reply: FastifyReply
) => {
  const planUpdaterUseCase = container.resolve(PlanUpdaterUseCase);
  const { t } = request;

  try {
    const response = await planUpdaterUseCase.execute(
      t,
      request.params.plan_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('plan_updated_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('plan_update_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
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
