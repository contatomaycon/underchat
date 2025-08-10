import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SectorViewerUseCase } from '@core/useCases/sector/SectorViewer.useCase';
import { ViewSectorRequest } from '@core/schema/sector/viewSector/request.schema';

export const viewSector = async (
  request: FastifyRequest<{
    Params: ViewSectorRequest;
  }>,
  reply: FastifyReply
) => {
  const sectorViewerUseCase = container.resolve(SectorViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await sectorViewerUseCase.execute(
      t,
      request.params.sector_id,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('sector_not_found'),
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
