import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { AttendanceInactivityService } from '@core/services/attendanceInactivity.service';
import { ViewChatAttendanceInactivityParams } from '@core/schema/chat/viewChatAttendanceInactivity/request.schema';
import { ViewChatAttendanceInactivityResponse } from '@core/schema/chat/viewChatAttendanceInactivity/response.schema';

@injectable()
export class ChatAttendanceInactivityViewerUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(AttendanceInactivityService)
    private readonly attendanceInactivityService: AttendanceInactivityService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: ViewChatAttendanceInactivityParams,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ViewChatAttendanceInactivityResponse> {
    const chat = await this.chatService.findChatByChatId(accountId, params.chat_id);

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    const disabled =
      await this.attendanceInactivityService.viewAttendanceInactivityDisabledForChat(
        chat
      );

    return { disabled };
  }
}
