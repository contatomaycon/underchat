import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SectorListerUseCase } from '@core/useCases/sector/SectorLister.useCase';
import { ListSectorRequest } from '@core/schema/sector/listSector/request.schema';

export const listSector = async (
  request: FastifyRequest<{
    Querystring: ListSectorRequest;
  }>,
  reply: FastifyReply
) => {
  const sectorListerUseCase = container.resolve(SectorListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await sectorListerUseCase.execute(
      t,
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('sector_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
