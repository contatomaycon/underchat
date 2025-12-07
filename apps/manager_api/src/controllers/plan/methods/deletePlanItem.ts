import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeletePlanItemRequest } from '@core/schema/plan/deletePlanItem/request.schema';
import { PlanItemDeleterUseCase } from '@core/useCases/plan/PlanItemDeleter.useCase';

export const deletePlanItem = async (
  request: FastifyRequest<{
    Params: DeletePlanItemRequest;
  }>,
  reply: FastifyReply
) => {
  const planItemDeleterUseCase = container.resolve(PlanItemDeleterUseCase);
  const { t } = request;

  try {
    const response = await planItemDeleterUseCase.execute(
      t,
      request.params.plan_item_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('plan_item_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }


    return sendResponse(reply, {
      message: t('plan_item_delete_failed'),
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
