import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { VoiceIaDeleterUseCase } from '@core/useCases/voiceIa/VoiceIaDeleter.useCase';

export const deleteVoiceIa = async (
  request: FastifyRequest<{
    Params: { voice_ia_id: string };
  }>,
  reply: FastifyReply
) => {
  const voiceIaDeleterUseCase = container.resolve(VoiceIaDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await voiceIaDeleterUseCase.execute(
      t,
      request.params.voice_ia_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('voice_ia_delete_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('voice_ia_delete_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
