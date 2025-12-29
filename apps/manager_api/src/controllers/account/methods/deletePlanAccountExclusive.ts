import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanAccountExclusiveDeleterUseCase } from '@core/useCases/planAccountExclusive/PlanAccountExclusiveDeleter.useCase';
import { DeletePlanAccountExclusiveRequest } from '@core/schema/planAccountExclusive/deletePlanAccountExclusive/request.schema';

export const deletePlanAccountExclusive = async (
  request: FastifyRequest<{
    Params: DeletePlanAccountExclusiveRequest;
  }>,
  reply: FastifyReply
) => {
  const planAccountExclusiveDeleterUseCase = container.resolve(
    PlanAccountExclusiveDeleterUseCase
  );
  const { t } = request;

  try {
    await planAccountExclusiveDeleterUseCase.execute(
      t,
      request.params.plan_account_exclusive_id
    );

    return sendResponse(reply, {
      message: t('plan_account_exclusive_deleted_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: null,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
