import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReleaseNotificationsListerUseCase } from '@core/useCases/release/ReleaseNotificationsLister.useCase';

export const listReleaseNotifications = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const useCase = container.resolve(ReleaseNotificationsListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const data = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.permission_role_id
    );

    return sendResponse(reply, {
      message: t('release_notifications_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
