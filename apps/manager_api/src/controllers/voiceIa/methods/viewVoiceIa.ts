import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { VoiceIaViewerUseCase } from '@core/useCases/voiceIa/VoiceIaViewer.useCase';

export const viewVoiceIa = async (
  request: FastifyRequest<{
    Params: { voice_ia_id: string };
  }>,
  reply: FastifyReply
) => {
  const voiceIaViewerUseCase = container.resolve(VoiceIaViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await voiceIaViewerUseCase.execute(
      request.params.voice_ia_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('voice_ia_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('voice_ia_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
