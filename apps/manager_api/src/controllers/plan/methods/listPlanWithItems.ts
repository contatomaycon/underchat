import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
  const { t, tokenJwtData } = request;

  try {
    const response = await planWithItemsListerUseCase.execute(
      tokenJwtData?.account_id || null
    );

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
    handleControllerError(error, reply, t);
  }
};
