import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationSectorsListerUseCase } from '@core/useCases/integration/IntegrationSectorsLister.useCase';

export const listSectors = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const integrationSectorsListerUseCase = container.resolve(
    IntegrationSectorsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await integrationSectorsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('sectors_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
