import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteMessageTemplateRequest } from '@core/schema/messageTemplate/deleteMessageTemplate/request.schema';
import { MessageTemplateDeleterUseCase } from '@core/useCases/messageTemplate/MessageTemplateDeleter.useCase';

export const deleteMessageTemplate = async (
  request: FastifyRequest<{
    Params: DeleteMessageTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const messageTemplateDeleterUseCase = container.resolve(
    MessageTemplateDeleterUseCase
  );
  const { t } = request;

  try {
    const response = await messageTemplateDeleterUseCase.execute(
      t,
      request.params.message_template_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('message_template_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }


    return sendResponse(reply, {
      message: t('message_template_deleter_error'),
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
