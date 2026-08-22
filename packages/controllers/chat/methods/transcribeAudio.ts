import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { TranscribeAudioParams } from '@core/schema/chat/transcribeAudio/request.schema';
import { TranscribeAudioMessageUseCase } from '@core/useCases/chat/TranscribeAudioMessage.useCase';
import { handleChatMessageControllerError } from './handleChatMessageControllerError';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

export const transcribeAudio = async (
  request: FastifyRequest<{
    Params: TranscribeAudioParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(TranscribeAudioMessageUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      tokenJwtData.user_id,
      tokenJwtData.channels,
      resolveOutboundWebhookRequestSource(request.module)
    );

    return sendResponse(reply, {
      message: t('audio_transcribed'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleChatMessageControllerError(error, reply, t);
  }
};
