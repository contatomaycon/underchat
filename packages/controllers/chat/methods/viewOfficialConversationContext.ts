import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { OfficialConversationContextParams } from '@core/schema/chat/officialConversationContext/request.schema';
import { OfficialConversationContextViewerUseCase } from '@core/useCases/chat/OfficialConversationContextViewer.useCase';

export const viewOfficialConversationContext = async (
  request: FastifyRequest<{
    Params: OfficialConversationContextParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(OfficialConversationContextViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.chat_id,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('official_conversation_context_loaded_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
