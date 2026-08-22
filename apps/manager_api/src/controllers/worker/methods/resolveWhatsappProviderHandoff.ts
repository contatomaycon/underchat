import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { WorkerWhatsappProviderHandoffUseCase } from '@core/useCases/worker/WorkerWhatsappProviderHandoff.useCase';
import {
  ResolveWhatsappProviderHandoffBody,
  ResolveWhatsappProviderHandoffParams,
} from '@core/schema/worker/whatsappProviderHandoff/request.schema';

export const resolveWhatsappProviderHandoff = async (
  request: FastifyRequest<{
    Params: ResolveWhatsappProviderHandoffParams;
    Body: ResolveWhatsappProviderHandoffBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerWhatsappProviderHandoffUseCase);
  const { t, tokenJwtData } = request;
  try {
    const response = await useCase.resolve(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.params.handoff_id,
      request.body.action
    );
    if (!response) {
      return sendResponse(reply, {
        message: t('worker_not_found'),
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }
    const httpStatusCode =
      response.status === 'blocked'
        ? EHTTPStatusCode.conflict
        : response.status === 'queued'
          ? EHTTPStatusCode.accepted
          : EHTTPStatusCode.ok;
    return sendResponse(reply, {
      message: t(
        response.status === 'blocked'
          ? 'worker_recreate_error'
          : 'channel_updated_successfully'
      ),
      httpStatusCode,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
