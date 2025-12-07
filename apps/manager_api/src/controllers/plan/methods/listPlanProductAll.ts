import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanProductAllListerUseCase } from '@core/useCases/plan/PlanProductAllLister.useCase';

export const listPlanProductAll = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const planProductAllListerUseCase = container.resolve(
    PlanProductAllListerUseCase
  );
  const { t } = request;

  try {
    const response = await planProductAllListerUseCase.execute();

    if (response) {
      return sendResponse(reply, {
        message: t('plan_product_list_all_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }


    return sendResponse(reply, {
      message: t('plan_product_list_all_not_found'),
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
