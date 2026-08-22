import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const channelsPage = readFileSync(
  resolve(process.cwd(), 'apps/web/src/pages/channels.vue'),
  'utf8'
);

describe('web official template manager link contract', () => {
  it('opens the manager URL belonging to the clicked channel', () => {
    expect(channelsPage).toContain(
      ':href="item.official_template_manager_url"'
    );
    expect(channelsPage).toContain('item.official_template_manager_url &&');
    expect(channelsPage).toContain('rel="noopener noreferrer"');
  });

  it('does not fall back to Meta session-global template selection', () => {
    expect(channelsPage).not.toContain(
      'META_WHATSAPP_MESSAGE_MODEL_MANAGER_URL'
    );
    expect(channelsPage).not.toContain(
      'message_templates?tab=message-templates&nav_ref=whatsapp_manager'
    );
  });
});
