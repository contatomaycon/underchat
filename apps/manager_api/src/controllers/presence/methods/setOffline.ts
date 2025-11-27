import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { PresenceService } from '@core/services/presence.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const setOffline = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const presenceService = container.resolve(PresenceService);
  const { t, tokenJwtData } = request;

  try {
    await presenceService.setUserOffline(tokenJwtData.user_id);

    return sendResponse(reply, {
      message: t('presence_offline_success'),
      httpStatusCode: EHTTPStatusCode.ok,
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
