import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateStartProtocolTextUseCase } from '@core/useCases/worker/UpdateStartProtocolText.useCase';
import {
  UpdateStartProtocolTextRequest,
  UpdateStartProtocolTextParams,
} from '@core/schema/worker/updateStartProtocolText/request.schema';

export const updateStartProtocolText = async (
  request: FastifyRequest<{
    Params: UpdateStartProtocolTextParams;
    Body: UpdateStartProtocolTextRequest;
  }>,
  reply: FastifyReply
) => {
  const updateStartProtocolTextUseCase = container.resolve(
    UpdateStartProtocolTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateStartProtocolTextUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('start_protocol_text_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
