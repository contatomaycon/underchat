import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanAccountExclusiveCreatorUseCase } from '@core/useCases/planAccountExclusive/PlanAccountExclusiveCreator.useCase';
import { CreatePlanAccountExclusiveRequest } from '@core/schema/planAccountExclusive/createPlanAccountExclusive/request.schema';

export const createPlanAccountExclusive = async (
  request: FastifyRequest<{
    Body: CreatePlanAccountExclusiveRequest;
  }>,
  reply: FastifyReply
) => {
  const planAccountExclusiveCreatorUseCase = container.resolve(
    PlanAccountExclusiveCreatorUseCase
  );
  const { t } = request;

  try {
    const planAccountExclusiveId =
      await planAccountExclusiveCreatorUseCase.execute(t, request.body);

    return sendResponse(reply, {
      message: t('plan_account_exclusive_created_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        plan_account_exclusive_id: planAccountExclusiveId,
      },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
