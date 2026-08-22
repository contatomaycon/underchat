import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateChatStatusBody,
  UpdateChatStatusParams,
} from '@core/schema/chat/updateChatStatus/request.schema';
import { ChatStatusUpdaterUseCase } from '@core/useCases/chat/ChatStatusUpdater.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const updateChatStatus = async (
  request: FastifyRequest<{
    Params: UpdateChatStatusParams;
    Body: UpdateChatStatusBody;
  }>,
  reply: FastifyReply
) => {
  const chatStatusUpdaterUseCase = container.resolve(ChatStatusUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatStatusUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.permission_role_id ?? null,
      tokenJwtData.sectors,
      request.params,
      request.body,
      tokenJwtData.actions,
      tokenJwtData.channels,
      undefined,
      resolveOutboundWebhookRequestSource(request.module)
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_status_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chat_status_update_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === t('closure_comment_required')) {
        return sendResponse(reply, {
          message: error.message,
          httpStatusCode: EHTTPStatusCode.bad_request,
          data: {
            reason: 'closure_comment_required',
          },
        });
      }
    }

    handleChatMutationControllerError(error, reply, t);
  }
};
