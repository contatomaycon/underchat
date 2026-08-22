import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatLabelTemplateListerUseCase } from '@core/useCases/chat/ChatLabelTemplateLister.useCase';

export const listLabelTemplates = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatLabelTemplateListerUseCase = container.resolve(
    ChatLabelTemplateListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatLabelTemplateListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('label_template_all_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
