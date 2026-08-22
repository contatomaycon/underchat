import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { ChatbotApiRequestTestError } from '@core/common/exceptions/ChatbotApiRequestTestError';
import type { TestApiRequestRequest } from '@core/schema/chatbot/testApiRequest/request.schema';
import { ChatbotApiRequestTesterUseCase } from '@core/useCases/chatbot/ChatbotApiRequestTester.useCase';

export const testApiRequest = async (
  request: FastifyRequest<{ Body: TestApiRequestRequest }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(ChatbotApiRequestTesterUseCase);
  const { t, tokenJwtData } = request;
  try {
    const result = await useCase.execute(
      request.body,
      tokenJwtData.account_id,
      tokenJwtData.user_id
    );
    return sendResponse(reply, {
      message: t('chatbot_api_request_test_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    if (error instanceof ChatbotApiRequestTestError) {
      return sendResponse(reply, {
        message: t(error.message),
        httpStatusCode: error.httpStatusCode,
        data: { code: error.code },
      });
    }
    return handleControllerError(error, reply, t);
  }
};
