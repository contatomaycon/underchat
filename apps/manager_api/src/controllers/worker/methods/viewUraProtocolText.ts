import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewUraProtocolTextUseCase } from '@core/useCases/worker/ViewUraProtocolText.useCase';
import { ViewUraProtocolTextParams } from '@core/schema/worker/viewUraProtocolText/request.schema';

export const viewUraProtocolText = async (
  request: FastifyRequest<{
    Params: ViewUraProtocolTextParams;
  }>,
  reply: FastifyReply
) => {
  const viewUraProtocolTextUseCase = container.resolve(
    ViewUraProtocolTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewUraProtocolTextUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('ura_protocol_text_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
