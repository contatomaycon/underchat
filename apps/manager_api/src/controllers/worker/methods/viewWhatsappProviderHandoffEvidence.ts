import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { WorkerWhatsappProviderHandoffUseCase } from '@core/useCases/worker/WorkerWhatsappProviderHandoff.useCase';
import {
  ViewWhatsappProviderHandoffEvidenceQuery,
  ViewWhatsappProviderHandoffParams,
} from '@core/schema/worker/whatsappProviderHandoff/request.schema';

export const viewWhatsappProviderHandoffEvidence = async (
  request: FastifyRequest<{
    Params: ViewWhatsappProviderHandoffParams;
    Querystring: ViewWhatsappProviderHandoffEvidenceQuery;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerWhatsappProviderHandoffUseCase);
  const { t, tokenJwtData } = request;
  try {
    const response = await useCase.viewOutboxEvidence({
      accountId: tokenJwtData.account_id,
      workerId: request.params.worker_id,
      afterOrder: request.query.after_order,
      operationId: request.query.operation_id,
      debugTraceId: request.query.debug_trace_id,
    });
    return sendResponse(reply, {
      message: t('worker_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
