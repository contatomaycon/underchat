import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RemoveChatContactLabelTemplateRequest } from '@core/schema/chat/removeContactLabelTemplate/request.schema';
import { ChatContactLabelTemplateRemoverUseCase } from '@core/useCases/chat/ChatContactLabelTemplateRemover.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const removeChatContactLabelTemplate = async (
  request: FastifyRequest<{
    Params: RemoveChatContactLabelTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const chatContactLabelTemplateRemoverUseCase = container.resolve(
    ChatContactLabelTemplateRemoverUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatContactLabelTemplateRemoverUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.contact_id,
      request.params.label_template_id,
      tokenJwtData.user_id,
      resolveOutboundWebhookRequestSource(request.module)
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_label_template_removed_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('contact_label_template_remove_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleChatMutationControllerError(error, reply, t);
  }
};
