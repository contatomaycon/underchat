import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  GenerateAiReplyParams,
  GenerateAiReplyBody,
} from '@core/schema/chat/generateAiReply/request.schema';
import { GenerateAiReplyUseCase } from '@core/useCases/chat/GenerateAiReply.useCase';

export const generateAiReply = async (
  request: FastifyRequest<{
    Params: GenerateAiReplyParams;
    Body: GenerateAiReplyBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(GenerateAiReplyUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body,
      tokenJwtData.user_id,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('ai_reply_generated'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
