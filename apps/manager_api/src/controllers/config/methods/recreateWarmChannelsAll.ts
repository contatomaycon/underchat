import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RecreateWarmChannelsAllRequest } from '@core/schema/config/recreateWarmChannelsAll/request.schema';
import { WarmChannelsRecreatorAllUseCase } from '@core/useCases/config/WarmChannelsRecreatorAll.useCase';

export const recreateWarmChannelsAll = async (
  request: FastifyRequest<{
    Body: RecreateWarmChannelsAllRequest;
  }>,
  reply: FastifyReply
) => {
  const warmChannelsRecreatorAllUseCase = container.resolve(
    WarmChannelsRecreatorAllUseCase
  );
  const { t } = request;

  try {
    const response = await warmChannelsRecreatorAllUseCase.execute(
      t,
      request.body
    );

    return sendResponse(reply, {
      message: t('warm_channels_recreate_all_enqueued'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
