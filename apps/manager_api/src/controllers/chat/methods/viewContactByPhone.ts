import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatContactByPhoneViewerUseCase } from '@core/useCases/chat/ChatContactByPhoneViewer.useCase';
import { ViewChatContactByPhoneQuery } from '@core/schema/chat/viewContactByPhone/request.schema';

export const viewContactByPhone = async (
  request: FastifyRequest<{
    Querystring: ViewChatContactByPhoneQuery;
  }>,
  reply: FastifyReply
) => {
  const chatContactByPhoneViewerUseCase = container.resolve(
    ChatContactByPhoneViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const allowedChannelIds = tokenJwtData.channels?.map((c) => c.id) ?? [];

    const response = await chatContactByPhoneViewerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.query.phone,
      request.query.phone_ddi,
      allowedChannelIds
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_not_found'),
      httpStatusCode: EHTTPStatusCode.not_found,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
