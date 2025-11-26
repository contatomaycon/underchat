import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatContactListerUseCase } from '@core/useCases/chat/ChatContactLister.useCase';
import { ListChatContactsRequest } from '@core/schema/chat/listContacts/request.schema';

export const listContacts = async (
  request: FastifyRequest<{
    Querystring: ListChatContactsRequest;
  }>,
  reply: FastifyReply
) => {
  const chatContactListerUseCase = container.resolve(ChatContactListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const perPage = request.query.per_page ?? 50;
    const currentPage = request.query.current_page ?? 1;
    const search = request.query.search;

    const response = await chatContactListerUseCase.execute(
      perPage,
      currentPage,
      tokenJwtData.account_id,
      search
    );

    return sendResponse(reply, {
      message: t('contact_list_successfully'),
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
