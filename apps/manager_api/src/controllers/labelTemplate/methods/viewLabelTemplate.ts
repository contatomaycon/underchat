import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewLabelTemplateRequest } from '@core/schema/labelTemplate/viewLabelTemplate/request.schema';
import { LabelTemplateViewerUseCase } from '@core/useCases/labelTemplate/LabelTemplateViewer.useCase';

export const viewLabelTemplate = async (
  request: FastifyRequest<{
    Params: ViewLabelTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const labelTemplateViewerUseCase = container.resolve(
    LabelTemplateViewerUseCase
  );
  const { t } = request;

  try {
    const response = await labelTemplateViewerUseCase.execute(
      t,
      request.params.label_template_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('label_template_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }


    return sendResponse(reply, {
      message: t('label_template_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
