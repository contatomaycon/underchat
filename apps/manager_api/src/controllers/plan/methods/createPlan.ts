import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreatePlanRequest } from '@core/schema/plan/createPlan/request.schema';
import { PlanCreatorUseCase } from '@core/useCases/plan/PlanCreator.useCase';

export const createPlan = async (
  request: FastifyRequest<{
    Body: CreatePlanRequest;
  }>,
  reply: FastifyReply
) => {
  const planCreatorUseCase = container.resolve(PlanCreatorUseCase);
  const { t } = request;

  try {
    const response = await planCreatorUseCase.execute(t, request.body);

    if (response) {
      return sendResponse(reply, {
        message: t('plan_created_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }


    return sendResponse(reply, {
      message: t('plan_creation_failed'),
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
