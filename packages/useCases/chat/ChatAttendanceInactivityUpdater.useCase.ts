import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { AttendanceInactivityService } from '@core/services/attendanceInactivity.service';
import {
  UpdateChatAttendanceInactivityParams,
  UpdateChatAttendanceInactivityRequest,
} from '@core/schema/chat/updateChatAttendanceInactivity/request.schema';

@injectable()
export class ChatAttendanceInactivityUpdaterUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(AttendanceInactivityService)
    private readonly attendanceInactivityService: AttendanceInactivityService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: UpdateChatAttendanceInactivityParams,
    body: UpdateChatAttendanceInactivityRequest,
    userChannels: { id: string; name: string }[] = []
  ): Promise<boolean> {
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

    await this.attendanceInactivityService.updateAttendanceInactivityDisabledForChat(
      chat,
      body.disabled
    );

    return true;
  }
}
