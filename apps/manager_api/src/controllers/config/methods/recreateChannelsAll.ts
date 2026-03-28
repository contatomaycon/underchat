import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EnqueueRecreateChannelsAllUseCase } from '@core/useCases/config/EnqueueRecreateChannelsAll.useCase';
import { RecreateChannelsAllRequest } from '@core/schema/config/recreateChannelsAll/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';

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
    const payload: Omit<IConfigChannelsRecreateAllPayload, 'account_id'> = {
      status:
        (request.body.status as EWorkerStatus | null | undefined) ??
        EWorkerStatus.online,
      type: (request.body.type as EWorkerType | null | undefined) ?? undefined,
      account: request.body.account || undefined,
      name: request.body.name || undefined,
      number: request.body.number || undefined,
    };
    await enqueueRecreateChannelsAllUseCase.execute(
      tokenJwtData.account_id,
      payload
    );

    return sendResponse(reply, {
      message: t('channels_recreate_all_enqueued'),
      httpStatusCode: EHTTPStatusCode.accepted,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
