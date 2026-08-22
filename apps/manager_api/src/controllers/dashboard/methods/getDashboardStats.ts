import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DashboardStatsViewerUseCase } from '@core/useCases/dashboard/DashboardStatsViewer.useCase';

export const getDashboardStats = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  reply.header('Cache-Control', 'no-store, max-age=0');
  const dashboardStatsViewerUseCase = container.resolve(
    DashboardStatsViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await dashboardStatsViewerUseCase.execute(
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('dashboard_stats_loaded_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('dashboard_stats_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
