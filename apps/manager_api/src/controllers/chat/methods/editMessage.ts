import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
    console.error(error);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
