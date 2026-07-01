import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { OfficialCapabilitiesRequest } from '@core/schema/chatbot/officialCapabilities/request.schema';
import { ChatbotOfficialCapabilitiesUseCase } from '@core/useCases/chatbot/ChatbotOfficialCapabilities.useCase';

export const officialCapabilities = async (
  request: FastifyRequest<{
    Querystring: OfficialCapabilitiesRequest;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(ChatbotOfficialCapabilitiesUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      request.query.chatbot_id,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('chatbot_official_capabilities_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
