import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { RemoveGroupMemberParams } from '@core/schema/internalChat/removeGroupMember/request.schema';
import { InternalChatGroupMemberRemoverUseCase } from '@core/useCases/internalChat/InternalChatGroupMemberRemover.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const removeGroupMember = async (
  request: FastifyRequest<{ Params: RemoveGroupMemberParams }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatGroupMemberRemoverUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.id,
      request.params.user_id
    );

    return sendResponse(reply, {
      message: t('chat_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response ? null : null,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
