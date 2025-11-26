import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateUraProtocolTextUseCase } from '@core/useCases/worker/UpdateUraProtocolText.useCase';
import {
  UpdateUraProtocolTextRequest,
  UpdateUraProtocolTextParams,
} from '@core/schema/worker/updateUraProtocolText/request.schema';

export const updateUraProtocolText = async (
  request: FastifyRequest<{
    Params: UpdateUraProtocolTextParams;
    Body: UpdateUraProtocolTextRequest;
  }>,
  reply: FastifyReply
) => {
  const updateUraProtocolTextUseCase = container.resolve(
    UpdateUraProtocolTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateUraProtocolTextUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('ura_protocol_text_update_success'),
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
