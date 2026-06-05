import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RecreateWarmChannelRequest } from '@core/schema/config/recreateWarmChannel/request.schema';
import { WarmChannelRecreatorUseCase } from '@core/useCases/config/WarmChannelRecreator.useCase';

export const recreateWarmChannel = async (
  request: FastifyRequest<{
    Params: RecreateWarmChannelRequest;
  }>,
  reply: FastifyReply
) => {
  const warmChannelRecreatorUseCase = container.resolve(
    WarmChannelRecreatorUseCase
  );
  const { t } = request;

  try {
    const response = await warmChannelRecreatorUseCase.execute(
      t,
      request.params.warm_pool_id
    );

    return sendResponse(reply, {
      message: t('warm_channel_recreate_enqueued'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
