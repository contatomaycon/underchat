import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateVoiceIaParams,
  UpdateVoiceIaBody,
} from '@core/schema/voiceIa/updateVoiceIa/request.schema';
import { VoiceIaUpdaterUseCase } from '@core/useCases/voiceIa/VoiceIaUpdater.useCase';

export const updateVoiceIa = async (
  request: FastifyRequest<{
    Params: UpdateVoiceIaParams;
    Body: UpdateVoiceIaBody;
  }>,
  reply: FastifyReply
) => {
  const voiceIaUpdaterUseCase = container.resolve(VoiceIaUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await voiceIaUpdaterUseCase.execute(
      t,
      request.params.voice_ia_id,
      tokenJwtData.account_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('voice_ia_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('voice_ia_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
