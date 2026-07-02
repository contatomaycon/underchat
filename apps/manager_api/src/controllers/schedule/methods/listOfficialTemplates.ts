import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleOfficialTemplatesRequest } from '@core/schema/schedule/officialTemplates/request.schema';
import { ScheduleOfficialTemplatesListerUseCase } from '@core/useCases/schedule/ScheduleOfficialTemplatesLister.useCase';

export const listOfficialTemplates = async (
  request: FastifyRequest<{
    Querystring: ScheduleOfficialTemplatesRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleOfficialTemplatesListerUseCase = container.resolve(
    ScheduleOfficialTemplatesListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleOfficialTemplatesListerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.query,
      tokenJwtData.channels ?? []
    );

    return sendResponse(reply, {
      message: t('schedule_official_templates_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
