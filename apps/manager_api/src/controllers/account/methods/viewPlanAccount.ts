import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
  const { t, tokenJwtData } = request;

  try {
    const response = await planAccountViewerUseCase.execute(
      t,
      request.params.account_id,
      tokenJwtData.is_administrator
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
    request.server.logger.error(error, request.id);

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
