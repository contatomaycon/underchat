import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import type { BulkUpdateContactLabelsRequest } from '@core/schema/contact/bulkUpdateContactLabels/request.schema';
import { ContactLabelsBulkUpdaterUseCase } from '@core/useCases/contact/ContactLabelsBulkUpdater.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const bulkUpdateContactLabels = async (
  request: FastifyRequest<{ Body: BulkUpdateContactLabelsRequest }>,
  reply: FastifyReply
) => {
  const contactLabelsBulkUpdaterUseCase = container.resolve(
    ContactLabelsBulkUpdaterUseCase
  );

  try {
    const response = await contactLabelsBulkUpdaterUseCase.execute(
      request.t,
      request.tokenJwtData.account_id,
      request.body,
      request.tokenJwtData.user_id,
      resolveOutboundWebhookRequestSource(request.module)
    );
    return sendResponse(reply, {
      message: request.t('contacts_bulk_labels_updated', {
        count: response.changed_count,
        failed: response.failed_count,
      }),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, request.t);
  }
};
