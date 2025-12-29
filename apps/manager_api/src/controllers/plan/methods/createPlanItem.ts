import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreatePlanItemRequest } from '@core/schema/plan/createPlanItem/request.schema';
import { PlanItemCreatorUseCase } from '@core/useCases/plan/PlanItemCreator.useCase';

export const createPlanItem = async (
  request: FastifyRequest<{
    Body: CreatePlanItemRequest;
  }>,
  reply: FastifyReply
) => {
  const planItemCreatorUseCase = container.resolve(PlanItemCreatorUseCase);
  const { t } = request;

  try {
    const response = await planItemCreatorUseCase.execute(t, request.body);

    if (response) {
      return sendResponse(reply, {
        message: t('plan_item_created_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('plan_item_creation_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
