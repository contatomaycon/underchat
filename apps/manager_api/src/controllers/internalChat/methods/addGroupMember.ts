import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  AddGroupMemberBody,
  AddGroupMemberParams,
} from '@core/schema/internalChat/addGroupMember/request.schema';
import { InternalChatGroupMemberAdderUseCase } from '@core/useCases/internalChat/InternalChatGroupMemberAdder.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const addGroupMember = async (
  request: FastifyRequest<{
    Params: AddGroupMemberParams;
    Body: AddGroupMemberBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatGroupMemberAdderUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
