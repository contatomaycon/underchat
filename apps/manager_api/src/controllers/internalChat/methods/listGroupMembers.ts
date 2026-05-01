import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ListGroupMembersParams } from '@core/schema/internalChat/listGroupMembers/request.schema';
import { InternalChatGroupMembersListerUseCase } from '@core/useCases/internalChat/InternalChatGroupMembersLister.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const listGroupMembers = async (
  request: FastifyRequest<{ Params: ListGroupMembersParams }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatGroupMembersListerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.id
    );

    return sendResponse(reply, {
      message: t('chat_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
