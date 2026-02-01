import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateVoiceIaRequest } from '@core/schema/voiceIa/createVoiceIa/request.schema';
import { VoiceIaCreatorUseCase } from '@core/useCases/voiceIa/VoiceIaCreator.useCase';

export const createVoiceIa = async (
  request: FastifyRequest<{
    Body: CreateVoiceIaRequest;
  }>,
  reply: FastifyReply
) => {
  const voiceIaCreatorUseCase = container.resolve(VoiceIaCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await voiceIaCreatorUseCase.execute(
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('voice_ia_add_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: {
          voice_ia_id: response,
        },
      });
    }

    return sendResponse(reply, {
      message: t('voice_ia_add_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
