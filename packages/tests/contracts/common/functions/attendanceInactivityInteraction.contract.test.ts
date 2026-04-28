import { EMessageType } from '@core/common/enums/EMessageType';
import { shouldResetAttendanceInactivityFromOperatorMessageType } from '@core/common/functions/attendanceInactivityInteraction';

describe('shouldResetAttendanceInactivityFromOperatorMessageType', () => {
  it('returns true for valid operator interactions', () => {
    const validTypes: EMessageType[] = [
      EMessageType.text,
      EMessageType.image,
      EMessageType.video,
      EMessageType.audio,
      EMessageType.document,
      EMessageType.location,
      EMessageType.contact_card,
      EMessageType.contacts,
    ];

    for (const type of validTypes) {
      expect(shouldResetAttendanceInactivityFromOperatorMessageType(type)).toBe(
        true
      );
    }
  });

  it('returns false for control/system types', () => {
    const invalidTypes: EMessageType[] = [
      EMessageType.system,
      EMessageType.annotation,
      EMessageType.react,
      EMessageType.set_disappearing_messages,
      EMessageType.edit_text,
      EMessageType.delete_message,
    ];

    for (const type of invalidTypes) {
      expect(shouldResetAttendanceInactivityFromOperatorMessageType(type)).toBe(
        false
      );
    }
  });
});
