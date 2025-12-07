import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeletePlanRequest } from '@core/schema/plan/deletePlan/request.schema';
import { PlanDeleterUseCase } from '@core/useCases/plan/PlanDeleter.useCase';

export const deletePlan = async (
  request: FastifyRequest<{
    Params: DeletePlanRequest;
  }>,
  reply: FastifyReply
) => {
  const planDeleterUseCase = container.resolve(PlanDeleterUseCase);
  const { t } = request;

  try {
    const response = await planDeleterUseCase.execute(
      t,
      request.params.plan_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('plan_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }


    return sendResponse(reply, {
      message: t('plan_delete_failed'),
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
