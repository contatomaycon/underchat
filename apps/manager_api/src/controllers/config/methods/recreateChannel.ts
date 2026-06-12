import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChannelRecreatorUseCase } from '@core/useCases/config/ChannelRecreator.useCase';
import { RecreateChannelRequest } from '@core/schema/config/recreateChannel/request.schema';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';

export const recreateChannel = async (
  request: FastifyRequest<{
    Params: RecreateChannelRequest;
  }>,
  reply: FastifyReply
) => {
  const channelRecreatorUseCase = container.resolve(ChannelRecreatorUseCase);
  const { t } = request;
  const debugTraceId = extractConnectionLifecycleDebugTraceIdFromHeaders(
    request.headers as Record<string, string | string[] | undefined>
  );

  try {
    const response = await channelRecreatorUseCase.execute(
      t,
      request.params.channel_id,
      debugTraceId
    );

    if (response) {
      return sendResponse(reply, {
        message: t('channel_recreate_success'),
        httpStatusCode: EHTTPStatusCode.accepted,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('channel_recreate_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
