import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('official provider-uncertain window presentation', () => {
  const openingCard = readSource(
    'apps/mobile/components/OfficialOpeningWindowCard.tsx'
  );
  const openingModal = readSource(
    'apps/mobile/components/ContactStartConversationModal.tsx'
  );
  const chatRoom = readSource('apps/mobile/screens/ChatRoomScreen.tsx');

  it('keeps uncertain sends locked and distinct from waiting for the contact', () => {
    expect(openingModal).toContain(
      "officialOpeningContext?.official_window.state === 'send_uncertain'"
    );
    expect(openingModal).toContain('isOfficialOpeningBlocked');
    expect(openingModal).toContain('pt.official_window_uncertain_description');
    expect(chatRoom).toContain("officialWindow?.state === 'send_uncertain'");
    expect(chatRoom).toContain('isOfficialSendUncertain ||');
    expect(openingCard).toContain("window.state === 'send_uncertain'");
    expect(openingCard).toContain('pt.official_window_uncertain_title');
  });

  it('reports queue acceptance and ambiguous delivery truthfully', () => {
    expect(chatRoom).toContain('pt.official_template_conversation_queued');
    expect(chatRoom).not.toContain(
      'Alert.alert(pt.success_title, pt.official_template_conversation_success)'
    );
    expect(chatRoom).toContain("message.delivery_status === 'ambiguous'");
    expect(chatRoom).toContain('pt.official_message_send_confirmation_pending');
  });
});
