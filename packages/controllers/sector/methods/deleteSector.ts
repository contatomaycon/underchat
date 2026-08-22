import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
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
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('sector_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
