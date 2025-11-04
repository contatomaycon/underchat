import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewMessageTemplateRequest } from '@core/schema/messageTemplate/viewMessageTemplate/request.schema';
import { MessageTemplateViewerUseCase } from '@core/useCases/messageTemplate/MessageTemplateViewer.useCase';

export const viewMessageTemplate = async (
  request: FastifyRequest<{
    Params: ViewMessageTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const messageTemplateViewerUseCase = container.resolve(
    MessageTemplateViewerUseCase
  );
  const { t } = request;

  try {
    const response = await messageTemplateViewerUseCase.execute(
      t,
      request.params.message_template_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('message_template_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('message_template_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

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
