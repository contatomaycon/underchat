import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SectorDeleterUseCase } from '@core/useCases/sector/SectorDeleter.useCase';
import { DeleteSectorRequest } from '@core/schema/sector/deleteSector/request.schema';

export const deleteSector = async (
  request: FastifyRequest<{
    Params: DeleteSectorRequest;
  }>,
  reply: FastifyReply
) => {
  const sectorDeleterUseCase = container.resolve(SectorDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await sectorDeleterUseCase.execute(
      t,
      request.params.sector_id,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('sector_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
