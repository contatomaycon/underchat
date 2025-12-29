import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
  const { t } = request;

  try {
    const response = await sectorUpdaterUseCase.execute(
      t,
      request.params.sector_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('sector_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
