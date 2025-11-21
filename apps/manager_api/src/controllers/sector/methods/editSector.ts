import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SectorUpdaterUseCase } from '@core/useCases/sector/SectorUpdater.useCase';
import {
  EditSectorParamsBody,
  EditSectorParamsRequest,
} from '@core/schema/sector/editSector/request.schema';

export const editSector = async (
  request: FastifyRequest<{
    Params: EditSectorParamsRequest;
    Body: EditSectorParamsBody;
  }>,
  reply: FastifyReply
) => {
  const sectorUpdaterUseCase = container.resolve(SectorUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await sectorUpdaterUseCase.execute(
      t,
      request.params.sector_id,
      request.body,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('sector_update_error'),
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
