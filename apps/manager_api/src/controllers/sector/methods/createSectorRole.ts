import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  CreateSectorRoleParams,
  CreateSectorRoleRequest,
} from '@core/schema/sector/createSectorRole/request.schema';
import { SectorRoleCreatorUseCase } from '@core/useCases/sector/SectorRoleCreator.useCase';

export const createSectorRole = async (
  request: FastifyRequest<{
    Params: CreateSectorRoleParams;
    Body: CreateSectorRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const sectorCreatorRoleUseCase = container.resolve(SectorRoleCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await sectorCreatorRoleUseCase.execute(
      t,
      request.params.sector_id,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_role_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('sector_role_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
