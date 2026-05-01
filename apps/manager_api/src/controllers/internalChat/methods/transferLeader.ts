import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  TransferLeaderBody,
  TransferLeaderParams,
} from '@core/schema/internalChat/transferLeader/request.schema';
import { InternalChatGroupLeaderTransferUseCase } from '@core/useCases/internalChat/InternalChatGroupLeaderTransfer.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const transferLeader = async (
  request: FastifyRequest<{
    Params: TransferLeaderParams;
    Body: TransferLeaderBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatGroupLeaderTransferUseCase);
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
