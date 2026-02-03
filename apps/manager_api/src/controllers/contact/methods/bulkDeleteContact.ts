import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BulkDeleteContactRequest } from '@core/schema/contact/bulkDeleteContact/request.schema';
import { ContactBulkDeleterUseCase } from '@core/useCases/contact/ContactBulkDeleter.useCase';

export const bulkDeleteContact = async (
  request: FastifyRequest<{
    Body: BulkDeleteContactRequest;
  }>,
  reply: FastifyReply
) => {
  const contactBulkDeleterUseCase = container.resolve(
    ContactBulkDeleterUseCase
  );
  const { t } = request;

  try {
    const response = await contactBulkDeleterUseCase.execute(
      t,
      request.body.contact_ids
    );

    if (response.deleted_count > 0) {
      return sendResponse(reply, {
        message:
          response.failed_count > 0
            ? t('contacts_bulk_deleted_partial', {
                deleted: response.deleted_count,
                failed: response.failed_count,
              })
            : t('contacts_bulk_deleted_successfully', {
                count: response.deleted_count,
              }),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contacts_bulk_delete_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
