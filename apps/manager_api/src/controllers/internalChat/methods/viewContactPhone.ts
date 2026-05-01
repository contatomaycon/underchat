import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ViewInternalChatContactPhoneParams } from '@core/schema/internalChat/viewContactPhone/request.schema';
import { InternalChatContactPhoneViewerUseCase } from '@core/useCases/internalChat/InternalChatContactPhoneViewer.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const viewContactPhone = async (
  request: FastifyRequest<{
    Params: ViewInternalChatContactPhoneParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatContactPhoneViewerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const allowedChannelIds = tokenJwtData.channels?.map((c) => c.id) ?? [];
    const response = await useCase.execute(
      tokenJwtData.account_id,
      request.params.contact_id,
      allowedChannelIds
    );

    return sendResponse(reply, {
      message: t('contact_phone_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
