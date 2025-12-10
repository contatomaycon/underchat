import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChannelsRecreatorAllUseCase } from '@core/useCases/config/ChannelsRecreatorAll.useCase';

export const recreateChannelsAll = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const channelsRecreatorAllUseCase = container.resolve(
    ChannelsRecreatorAllUseCase
  );
  const { t } = request;

  try {
    const result = await channelsRecreatorAllUseCase.execute(t);

    return sendResponse(reply, {
      message: t('channels_recreate_all_success', {
        success: result.success,
        errors: result.errors,
      }),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
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
