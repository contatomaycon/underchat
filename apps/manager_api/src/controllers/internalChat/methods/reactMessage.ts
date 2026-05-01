import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  ReactMessageBody,
  ReactMessageParams,
} from '@core/schema/internalChat/reactMessage/request.schema';
import { InternalChatMessageReactorUseCase } from '@core/useCases/internalChat/InternalChatMessageReactor.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const reactMessage = async (
  request: FastifyRequest<{
    Params: ReactMessageParams;
    Body: ReactMessageBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatMessageReactorUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id,
      request.params.message_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_reaction_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response ? null : null,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
