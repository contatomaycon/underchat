import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ConfigChannelConnectionHealthUseCase } from '@core/useCases/config/ConfigChannelConnectionHealth.useCase';
import type { ConfigChannelConnectionHealthRequest } from '@core/schema/config/channelConnectionHealth/request.schema';
import type { WorkerConnectionLogsQuery } from '@core/schema/worker/workerConnectionLogs/request.schema';

export const channelConnectionHealth = async (
  request: FastifyRequest<{
    Params: ConfigChannelConnectionHealthRequest;
    Querystring: WorkerConnectionLogsQuery;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(ConfigChannelConnectionHealthUseCase);
  const { t } = request;

  try {
    const response = await useCase.execute(
      t,
      request.params.channel_id,
      request.query
    );

    return sendResponse(reply, {
      message: t('worker_connection_logs_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    if (error instanceof Error) {
      const statusCodeByMessage: Record<string, EHTTPStatusCode> = {
        [t('worker_not_found')]: EHTTPStatusCode.not_found,
        [t('worker_connection_health_database_only')]:
          EHTTPStatusCode.bad_request,
      };
      const httpStatusCode = statusCodeByMessage[error.message];

      if (httpStatusCode) {
        return sendResponse(reply, {
          message: error.message,
          httpStatusCode,
        });
      }
    }

    handleControllerError(error, reply, t);
  }
};
