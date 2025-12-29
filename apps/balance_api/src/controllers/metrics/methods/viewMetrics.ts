import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { MetricsViewerUseCase } from '@core/useCases/metrics/MetricsViewer.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const viewMetrics = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const metricsViewerUseCase = container.resolve(MetricsViewerUseCase);
  const { t } = request;

  try {
    const responseMetricsView = await metricsViewerUseCase.execute();

    if (responseMetricsView) {
      return sendResponse(reply, {
        message: t('metrics_server_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: responseMetricsView,
      });
    }

    return sendResponse(reply, {
      message: t('metrics_server_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};