import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { WorkerWhatsappProviderHandoffUseCase } from '@core/useCases/worker/WorkerWhatsappProviderHandoff.useCase';
import { ViewWhatsappProviderHandoffParams } from '@core/schema/worker/whatsappProviderHandoff/request.schema';

export const viewWhatsappProviderHandoff = async (
  request: FastifyRequest<{ Params: ViewWhatsappProviderHandoffParams }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerWhatsappProviderHandoffUseCase);
  const { t, tokenJwtData } = request;
  try {
    const response = await useCase.viewLatest(
      tokenJwtData.account_id,
      request.params.worker_id
    );
    return sendResponse(reply, {
      // A provider handoff is optional. The browser asks for it while it
      // reconciles a channel update, so its absence is a successful empty
      // lookup—not a missing worker or a transport failure. Returning 200
      // prevents clients from retrying an expected absence as an error.
      message: t(
        response ? 'worker_view_success' : 'worker_provider_handoff_not_found'
      ),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
