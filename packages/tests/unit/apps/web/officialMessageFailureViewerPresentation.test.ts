import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'apps/web/src/components/chat/ChatLogViewer.vue'),
  'utf8'
);

describe('official message failure presentation in chat history', () => {
  it('distinguishes an uncertain provider outcome from a definitive failure', () => {
    expect(source).toContain("message.delivery_status === 'ambiguous'");
    expect(source).toContain("icon: 'tabler-help-hexagon'");
    expect(source).toContain("color: 'warning'");
    expect(source).toContain("t('chat_message_send_confirmation_pending')");
    expect(source).toContain('message.summary?.is_sent_to_internal === false');
    expect(source).toContain("t('chat_message_send_failed')");
  });

  it('explains Meta parameter mismatch and exposes provider codes accessibly', () => {
    expect(source).toContain('errorCode === 132000');
    expect(source).toContain(
      "t('chat_message_send_failed_template_parameters')"
    );
    expect(source).toContain(
      "t('chat_message_send_failed_provider', { code: errorCode })"
    );
    expect(source).toMatch(
      /:title=\s*"\s*resolveFeedbackIcon\(item\.message\)\?\.label\s*"/
    );
    expect(source).toMatch(
      /:aria-label=\s*"\s*resolveFeedbackIcon\(item\.message\)\?\.label\s*"/
    );
  });
});
