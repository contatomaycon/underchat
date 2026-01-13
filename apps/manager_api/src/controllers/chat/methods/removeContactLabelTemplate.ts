import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RemoveChatContactLabelTemplateRequest } from '@core/schema/chat/removeContactLabelTemplate/request.schema';
import { ChatContactLabelTemplateRemoverUseCase } from '@core/useCases/chat/ChatContactLabelTemplateRemover.useCase';

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
      request.params.label_template_id
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
    handleControllerError(error, reply, t);
  }
};
