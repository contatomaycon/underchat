import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  SendOfficialTemplateParams,
  SendOfficialTemplateRequest,
} from '@core/schema/chat/sendOfficialTemplate/request.schema';
import { SendOfficialTemplateToChatUseCase } from '@core/useCases/chat/SendOfficialTemplateToChat.useCase';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const sendOfficialTemplate = async (
  request: FastifyRequest<{
    Params: SendOfficialTemplateParams;
    Body: SendOfficialTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(SendOfficialTemplateToChatUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.chat_id,
      tokenJwtData.user_id,
      request.body,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('official_template_queued_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleChatMutationControllerError(error, reply, t, {
      sanitizeUnexpected: true,
    });
  }
};
