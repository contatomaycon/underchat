import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
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
    const allowedChannelIds = tokenJwtData.channels?.map((c) => c.id) ?? [];

    const response = await chatContactListerUseCase.execute(
      perPage,
      currentPage,
      tokenJwtData.account_id,
      request.query,
      allowedChannelIds
    );

    return sendResponse(reply, {
      message: t('contact_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
