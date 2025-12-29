import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SectorRoleAccountSectorListerUseCase } from '@core/useCases/sector/SectorRoleAccountSectorViewer.useCase';
import { CreateSectorRoleAccountSectorRequest } from '@core/schema/sector/viewSectorRoleAccountSector/request.schema';

export const listSectorRoleAccountSector = async (
  request: FastifyRequest<{
    Params: CreateSectorRoleAccountSectorRequest;
  }>,
  reply: FastifyReply
) => {
  const sectorRoleAccountSectorListUseCase = container.resolve(
    SectorRoleAccountSectorListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await sectorRoleAccountSectorListUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.sector_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_role_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('sector_role_not_found'),
      httpStatusCode: EHTTPStatusCode.not_found,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
