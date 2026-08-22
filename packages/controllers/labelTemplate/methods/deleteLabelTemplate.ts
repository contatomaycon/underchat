import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteLabelTemplateRequest } from '@core/schema/labelTemplate/deleteLabelTemplate/request.schema';
import { LabelTemplateDeleterUseCase } from '@core/useCases/labelTemplate/LabelTemplateDeleter.useCase';

export const deleteLabelTemplate = async (
  request: FastifyRequest<{
    Params: DeleteLabelTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const labelTemplateDeleterUseCase = container.resolve(
    LabelTemplateDeleterUseCase
  );
  const { t } = request;

  try {
    const response = await labelTemplateDeleterUseCase.execute(
      t,
      request.params.label_template_id,
      request.tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('label_template_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('label_template_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
