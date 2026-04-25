import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ServerBuildGenerateRequest } from '@core/schema/server/generateServerBuild/request.schema';
import { ServerBuildGeneratorUseCase } from '@core/useCases/server/ServerBuildGenerator.useCase';

export const generateServerBuild = async (
  request: FastifyRequest<{
    Body: ServerBuildGenerateRequest;
  }>,
  reply: FastifyReply
) => {
  const serverBuildGeneratorUseCase = container.resolve(
    ServerBuildGeneratorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await serverBuildGeneratorUseCase.execute(
      t,
      tokenJwtData.user_id,
      request.body
    );

    if (response.status === 'conflict') {
      return sendResponse(reply, {
        message: t('server_build_generate_conflict'),
        httpStatusCode: EHTTPStatusCode.conflict,
      });
    }

    if (response.status === 'invalid') {
      return sendResponse(reply, {
        message: t(response.message),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('server_build_generate_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response.data,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
