import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  JoinChatParams,
  JoinChatBody,
} from '@core/schema/chat/joinChat/request.schema';
import { JoinChatUseCase } from '@core/useCases/chat/JoinChat.useCase';

export const joinChat = async (
  request: FastifyRequest<{
    Params: JoinChatParams;
    Body: JoinChatBody;
  }>,
  reply: FastifyReply
) => {
  const joinChatUseCase = container.resolve(JoinChatUseCase);
  const { t, tokenJwtData } = request;
  const body = (request.body ?? undefined) as JoinChatBody;

  try {
    const response = await joinChatUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      body,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('chat_join_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
