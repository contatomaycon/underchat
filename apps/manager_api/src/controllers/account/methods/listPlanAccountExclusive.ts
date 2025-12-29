import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanAccountExclusiveListerUseCase } from '@core/useCases/planAccountExclusive/PlanAccountExclusiveLister.useCase';
import { ListPlanAccountExclusiveRequest } from '@core/schema/planAccountExclusive/listPlanAccountExclusive/request.schema';

export const listPlanAccountExclusive = async (
  request: FastifyRequest<{
    Params: ListPlanAccountExclusiveRequest;
  }>,
  reply: FastifyReply
) => {
  const planAccountExclusiveListerUseCase = container.resolve(
    PlanAccountExclusiveListerUseCase
  );
  const { t } = request;

  try {
    const response = await planAccountExclusiveListerUseCase.execute(
      t,
      request.params.account_id
    );

    return sendResponse(reply, {
      message: t('plan_account_exclusive_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
