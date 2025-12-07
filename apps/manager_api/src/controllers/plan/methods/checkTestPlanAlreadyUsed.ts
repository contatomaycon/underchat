import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { TestPlanAlreadyUsedCheckerUseCase } from '@core/useCases/plan/TestPlanAlreadyUsedChecker.useCase';

export const checkTestPlanAlreadyUsed = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const testPlanAlreadyUsedCheckerUseCase = container.resolve(
    TestPlanAlreadyUsedCheckerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const alreadyUsed = await testPlanAlreadyUsedCheckerUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('current_plan_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        already_used: alreadyUsed,
      },
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
