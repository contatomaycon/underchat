import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatContactPhoneViewerUseCase } from '@core/useCases/chat/ChatContactPhoneViewer.useCase';
import { ViewChatContactPhoneParams } from '@core/schema/chat/viewContactPhone/request.schema';

export const viewContactPhone = async (
  request: FastifyRequest<{
    Params: ViewChatContactPhoneParams;
  }>,
  reply: FastifyReply
) => {
  const chatContactPhoneViewerUseCase = container.resolve(
    ChatContactPhoneViewerUseCase
  );
  const { t } = request;

  try {
    const response = await chatContactPhoneViewerUseCase.execute(
      t,
      request.params.contact_id,
      request.tokenJwtData.account_id,
      request.tokenJwtData.channels?.map((channel) => channel.id) ?? []
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_phone_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
