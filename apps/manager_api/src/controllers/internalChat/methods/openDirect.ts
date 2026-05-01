import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { OpenDirectBody } from '@core/schema/internalChat/openDirect/request.schema';
import { InternalChatOpenDirectUseCase } from '@core/useCases/internalChat/InternalChatOpenDirect.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const openDirect = async (
  request: FastifyRequest<{ Body: OpenDirectBody }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatOpenDirectUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_create_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
