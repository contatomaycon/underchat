import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanWithItemsListerUseCase } from '@core/useCases/plan/PlanWithItemsLister.useCase';

export const listPlanWithItems = async (
  request: FastifyRequest<{}>,
  reply: FastifyReply
) => {
  const planWithItemsListerUseCase = container.resolve(
    PlanWithItemsListerUseCase
  );
  const { t } = request;

  try {
    const response = await planWithItemsListerUseCase.execute(null);

    if (response) {
      return sendResponse(reply, {
        message: t('plan_list_with_items_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('plan_list_with_items_not_found'),
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
