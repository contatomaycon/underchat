import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SectorRoleAccountListerUseCase } from '@core/useCases/sector/SectorRoleAccountViewer.useCase';

export const listSectorRoleAccount = async (
  request: FastifyRequest<{}>,
  reply: FastifyReply
) => {
  const sectorRoleAccountListUseCase = container.resolve(
    SectorRoleAccountListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await sectorRoleAccountListUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('sector_role_account_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('sector_role_account_not_found'),
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
