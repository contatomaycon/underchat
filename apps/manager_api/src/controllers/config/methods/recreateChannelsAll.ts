import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
