import { EMessageType } from '@core/common/enums/EMessageType';

const OPERATOR_INACTIVITY_RESET_MESSAGE_TYPES = new Set<EMessageType>([
  EMessageType.text,
  EMessageType.location,
  EMessageType.contact_card,
  EMessageType.contacts,
  EMessageType.image,
  EMessageType.video,
  EMessageType.video_note,
  EMessageType.audio,
  EMessageType.sticker,
  EMessageType.document,
  EMessageType.view_once,
]);

export function shouldResetAttendanceInactivityFromOperatorMessageType(
  messageType: EMessageType
): boolean {
  return OPERATOR_INACTIVITY_RESET_MESSAGE_TYPES.has(messageType);
}
