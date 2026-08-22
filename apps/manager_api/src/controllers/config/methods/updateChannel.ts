import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChannelUpdaterUseCase } from '@core/useCases/config/ChannelUpdater.useCase';
import {
  UpdateChannelBody,
  UpdateChannelParams,
} from '@core/schema/config/updateChannel/request.schema';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';

function isLifecycleAck(value: unknown): value is IWorkerLifecycleAck {
  return (
    typeof value === 'object' &&
    value !== null &&
    'queued' in value &&
    (value as { queued?: unknown }).queued === true
  );
}

export const updateChannel = async (
  request: FastifyRequest<{
    Params: UpdateChannelParams;
    Body: UpdateChannelBody;
  }>,
  reply: FastifyReply
) => {
  const channelUpdaterUseCase = container.resolve(ChannelUpdaterUseCase);
  const { t } = request;
  const debugTraceId = extractConnectionLifecycleDebugTraceIdFromHeaders(
    request.headers as Record<string, string | string[] | undefined>
  );

  try {
    const input = {
      channel_id: request.params.channel_id,
      name: request.body.name,
      worker_type: request.body.worker_type,
      server_id: request.body.server_id,
      connection_strategy: request.body.connection_strategy,
    };
    const response = debugTraceId
      ? await channelUpdaterUseCase.execute(t, input, debugTraceId)
      : await channelUpdaterUseCase.execute(t, input);

    if (response) {
      if (isLifecycleAck(response)) {
        return sendResponse(reply, {
          message: t('channel_updated_successfully'),
          httpStatusCode: EHTTPStatusCode.accepted,
          data: response,
        });
      }

      return sendResponse(reply, {
        message: t('channel_updated_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('channel_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
