import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatboxSectorUsersListerUseCase } from '@core/useCases/chatbox/ChatboxSectorUsersLister.useCase';
import { ListChatboxSectorUsersParams } from '@core/schema/chatbox/listSectorUsers/request.schema';

export const listSectorUsers = async (
  request: FastifyRequest<{
    Params: ListChatboxSectorUsersParams;
  }>,
  reply: FastifyReply
) => {
  const chatboxSectorUsersListerUseCase = container.resolve(
    ChatboxSectorUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatboxSectorUsersListerUseCase.execute(
      tokenJwtData.account_id,
      request.params.sector_id
    );

    return sendResponse(reply, {
      message: t('chatbox_sector_users_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
