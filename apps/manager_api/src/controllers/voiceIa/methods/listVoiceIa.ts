import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListVoiceIaRequest } from '@core/schema/voiceIa/listVoiceIa/request.schema';
import { VoiceIaListerUseCase } from '@core/useCases/voiceIa/VoiceIaLister.useCase';

export const listVoiceIa = async (
  request: FastifyRequest<{
    Querystring: ListVoiceIaRequest;
  }>,
  reply: FastifyReply
) => {
  const voiceIaListerUseCase = container.resolve(VoiceIaListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await voiceIaListerUseCase.execute(
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('voice_ia_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('voice_ia_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
