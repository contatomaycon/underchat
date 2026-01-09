import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DashboardAdditionalViewerUseCase } from '@core/useCases/dashboard/DashboardAdditionalViewer.useCase';

export const getDashboardAdditional = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const dashboardAdditionalViewerUseCase = container.resolve(
    DashboardAdditionalViewerUseCase
  );
  const { t, tokenJwtData } = request;

  if (!tokenJwtData?.account_id) {
    return sendResponse(reply, {
      message: t('not_authorized'),
      httpStatusCode: EHTTPStatusCode.unauthorized,
    });
  }

  try {
    const response = await dashboardAdditionalViewerUseCase.execute(
      tokenJwtData.account_id,
      t
    );

    if (response) {
      return sendResponse(reply, {
        message: t('dashboard_additional_loaded_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('dashboard_additional_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
