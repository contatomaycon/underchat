import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BulkActionChatRequest } from '@core/schema/chat/bulkAction/request.schema';
import { ChatBulkActionUseCase } from '@core/useCases/chat/ChatBulkAction.useCase';

export const bulkActionChat = async (
  request: FastifyRequest<{
    Body: BulkActionChatRequest;
  }>,
  reply: FastifyReply
) => {
  const chatBulkActionUseCase = container.resolve(ChatBulkActionUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatBulkActionUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.permission_role_id ?? null,
      request.body,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    if (response.total_targeted === 0) {
      return sendResponse(reply, {
        message: t('chat_bulk_action_no_targets'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    if (response.success_count > 0 && response.failed_count > 0) {
      return sendResponse(reply, {
        message: t('chat_bulk_action_partial', {
          success: response.success_count,
          failed: response.failed_count,
        }),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    if (response.success_count > 0) {
      return sendResponse(reply, {
        message: t('chat_bulk_action_success', {
          count: response.success_count,
        }),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chat_bulk_action_all_failed'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
