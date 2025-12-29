import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditMessageParams,
  EditMessageBody,
} from '@core/schema/chat/editMessage/request.schema';
import { ChatMessageEditorUseCase } from '@core/useCases/chat/ChatMessageEditor.useCase';

export const editMessage = async (
  request: FastifyRequest<{
    Params: EditMessageParams;
    Body: EditMessageBody;
  }>,
  reply: FastifyReply
) => {
  const chatMessageEditorUseCase = container.resolve(ChatMessageEditorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatMessageEditorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_edit_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chat_edit_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
