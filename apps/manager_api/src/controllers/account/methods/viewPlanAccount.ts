import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewPlanAccountParamsRequest } from '@core/schema/planAccount/viewPlanAccount/request.schema';
import { PlanAccountViewerUseCase } from '@core/useCases/planAccount/PlanAccountViewer.useCase';

export const viewPlanAccount = async (
  request: FastifyRequest<{
    Params: ViewPlanAccountParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const planAccountViewerUseCase = container.resolve(PlanAccountViewerUseCase);
  const { t } = request;

  try {
    const response = await planAccountViewerUseCase.execute(
      t,
      request.params.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('plan_account_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('plan_account_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
