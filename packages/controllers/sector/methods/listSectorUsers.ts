import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SectorUsersListerUseCase } from '@core/useCases/sector/SectorUsersLister.useCase';
import { ListSectorUsersRequest } from '@core/schema/sector/listSectorUsers/request.schema';

export const listSectorUsers = async (
  request: FastifyRequest<{
    Params: ListSectorUsersRequest;
  }>,
  reply: FastifyReply
) => {
  const sectorUsersListerUseCase = container.resolve(SectorUsersListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await sectorUsersListerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.sector_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_users_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('sector_users_not_found'),
      httpStatusCode: EHTTPStatusCode.not_found,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
