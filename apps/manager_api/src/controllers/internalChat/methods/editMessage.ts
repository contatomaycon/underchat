import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  EditMessageBody,
  EditMessageParams,
} from '@core/schema/internalChat/editMessage/request.schema';
import { InternalChatMessageEditorUseCase } from '@core/useCases/internalChat/InternalChatMessageEditor.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const editMessage = async (
  request: FastifyRequest<{ Params: EditMessageParams; Body: EditMessageBody }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatMessageEditorUseCase);
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
      message: t('chat_edit_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response ? null : null,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
