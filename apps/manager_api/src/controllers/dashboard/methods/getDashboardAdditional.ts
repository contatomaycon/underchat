import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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

  try {
    const response = await dashboardAdditionalViewerUseCase.execute(
      tokenJwtData.account_id
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
