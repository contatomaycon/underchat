import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListKanbanQuery } from '@core/schema/chat/listKanban/request.schema';
import { KanbanListerUseCase } from '@core/useCases/chat/KanbanLister.useCase';

export const listKanban = async (
  request: FastifyRequest<{
    Querystring: ListKanbanQuery;
  }>,
  reply: FastifyReply
) => {
  const kanbanListerUseCase = container.resolve(KanbanListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await kanbanListerUseCase.execute(
      tokenJwtData.account_id,
      request.query,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('kanban_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
