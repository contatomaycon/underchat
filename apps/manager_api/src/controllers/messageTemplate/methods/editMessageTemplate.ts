import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditMessageTemplateParamsRequest,
  UpdateMessageTemplateRequest,
} from '@core/schema/messageTemplate/editMessageTemplate/request.schema';
import { MessageTemplateUpdaterUseCase } from '@core/useCases/messageTemplate/MessageTemplateUpdater.useCase';

export const editMessageTemplate = async (
  request: FastifyRequest<{
    Params: EditMessageTemplateParamsRequest;
    Body: UpdateMessageTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const messageTemplateUpdaterUseCase = container.resolve(
    MessageTemplateUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await messageTemplateUpdaterUseCase.execute(
      t,
      request.params.message_template_id,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('message_template_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('message_template_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
