import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EnqueueRecreateChannelsAllUseCase } from '@core/useCases/config/EnqueueRecreateChannelsAll.useCase';
import { RecreateChannelsAllRequest } from '@core/schema/config/recreateChannelsAll/request.schema';

export const recreateChannelsAll = async (
  request: FastifyRequest<{
    Body: RecreateChannelsAllRequest;
  }>,
  reply: FastifyReply
) => {
  const enqueueRecreateChannelsAllUseCase = container.resolve(
    EnqueueRecreateChannelsAllUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const status = request.body.status || undefined;
    await enqueueRecreateChannelsAllUseCase.execute(
      tokenJwtData.account_id,
      status
    );

    return sendResponse(reply, {
      message: t('channels_recreate_all_enqueued'),
      httpStatusCode: EHTTPStatusCode.accepted,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
