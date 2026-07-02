import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { OfficialTemplatesRequest } from '@core/schema/chatbot/officialTemplates/request.schema';
import { ChatbotOfficialTemplatesListerUseCase } from '@core/useCases/chatbot/ChatbotOfficialTemplatesLister.useCase';

export const officialTemplates = async (
  request: FastifyRequest<{
    Querystring: OfficialTemplatesRequest;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(ChatbotOfficialTemplatesListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      request.query.chatbot_id,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('chatbot_official_templates_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
