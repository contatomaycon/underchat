import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ListInternalChatContactsRequest } from '@core/schema/internalChat/listContacts/request.schema';
import { InternalChatContactsListerUseCase } from '@core/useCases/internalChat/InternalChatContactsLister.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const listContacts = async (
  request: FastifyRequest<{ Querystring: ListInternalChatContactsRequest }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatContactsListerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const allowedChannelIds = tokenJwtData.channels?.map((c) => c.id) ?? [];
    const response = await useCase.execute(
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
    handleInternalChatError(error, reply, t);
  }
};
