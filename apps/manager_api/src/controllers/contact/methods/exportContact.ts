import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ContactExporterUseCase } from '@core/useCases/contact/ContactExporter.useCase';
import { ExportContactRequest } from '@core/schema/contact/exportContact/request.schema';

export const exportContact = async (
  request: FastifyRequest<{ Querystring: ExportContactRequest }>,
  reply: FastifyReply
) => {
  const contactExporterUseCase = container.resolve(ContactExporterUseCase);
  const { t, tokenJwtData, query } = request;

  let contactIds: string[] | null = null;
  if (query.contact_ids) {
    if (Array.isArray(query.contact_ids)) {
      contactIds = query.contact_ids;
    } else if (typeof query.contact_ids === 'string') {
      contactIds = query.contact_ids
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    }
  }

  try {
    const response = await contactExporterUseCase.execute(
      t,
      tokenJwtData.account_id,
      contactIds && contactIds.length > 0 ? contactIds : null
    );

    return sendResponse(reply, {
      message: t('contact_export_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
