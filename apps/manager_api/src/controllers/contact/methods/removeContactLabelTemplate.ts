import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RemoveContactLabelTemplateRequest } from '@core/schema/contact/removeContactLabelTemplate/request.schema';
import { ContactLabelTemplateRemoverUseCase } from '@core/useCases/contact/ContactLabelTemplateRemover.useCase';

export const removeContactLabelTemplate = async (
  request: FastifyRequest<{
    Params: RemoveContactLabelTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const contactLabelTemplateRemoverUseCase = container.resolve(
    ContactLabelTemplateRemoverUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await contactLabelTemplateRemoverUseCase.execute(
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
