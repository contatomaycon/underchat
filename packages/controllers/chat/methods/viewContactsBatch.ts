import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatContactsBatchViewerUseCase } from '@core/useCases/chat/ChatContactsBatchViewer.useCase';
import { ViewChatContactsBatchRequest } from '@core/schema/chat/viewContactsBatch/request.schema';

export const viewContactsBatch = async (
  request: FastifyRequest<{
    Body: ViewChatContactsBatchRequest;
  }>,
  reply: FastifyReply
) => {
  const chatContactsBatchViewerUseCase = container.resolve(
    ChatContactsBatchViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const allowedChannelIds = tokenJwtData.channels?.map((c) => c.id) ?? [];

    const response = await chatContactsBatchViewerUseCase.execute(
      request.body.contact_ids,
      tokenJwtData.account_id,
      allowedChannelIds
    );

    return sendResponse(reply, {
      message: t('contacts_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
