import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListPlanItemsRequest } from '@core/schema/plan/listPlanItems/request.schema';
import { PlanItemsListerUseCase } from '@core/useCases/plan/PlanItemsLister.useCase';

export const listPlanItems = async (
  request: FastifyRequest<{
    Params: ListPlanItemsRequest;
  }>,
  reply: FastifyReply
) => {
  const planItemsListerUseCase = container.resolve(PlanItemsListerUseCase);
  const { t } = request;

  try {
    const response = await planItemsListerUseCase.execute(
      t,
      request.params.plan_id
    );

    return sendResponse(reply, {
      message: t('plan_items_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
