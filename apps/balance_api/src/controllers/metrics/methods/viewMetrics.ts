import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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

    request.server.logger.info(responseMetricsView, request.id);

    return sendResponse(reply, {
      message: t('metrics_server_error'),
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
