import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { BulkUpdateContactDetailsRequest } from '@core/schema/contact/bulkUpdateContactDetails/request.schema';
import { ContactDetailsBulkUpdaterUseCase } from '@core/useCases/contact/ContactDetailsBulkUpdater.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const bulkUpdateContactDetails = async (
  request: FastifyRequest<{ Body: BulkUpdateContactDetailsRequest }>,
  reply: FastifyReply
) => {
  const contactDetailsBulkUpdaterUseCase = container.resolve(
    ContactDetailsBulkUpdaterUseCase
  );

  try {
    const response = await contactDetailsBulkUpdaterUseCase.execute({
      accountId: request.tokenJwtData.account_id,
      actorUserId: request.tokenJwtData.user_id,
      allowedChannelIds:
        request.tokenJwtData.channels?.map((channel) => channel.id) ?? [],
      request: request.body,
      t: request.t,
      webhookSource: resolveOutboundWebhookRequestSource(request.module),
    });
    return sendResponse(reply, {
      message: request.t('contacts_bulk_details_updated', {
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
