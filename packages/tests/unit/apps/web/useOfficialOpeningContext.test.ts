import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'apps/web/src/composables/useOfficialOpeningContext.ts'
  ),
  'utf8'
);

describe('useOfficialOpeningContext source contract', () => {
  it('fences stale context responses by request sequence', () => {
    expect(source).toContain('const requestId = ++requestSequence;');
    expect(source.match(/requestId !== requestSequence/g)).toHaveLength(2);
    expect(source).toContain('context.value = result');
    expect(source.indexOf('requestId !== requestSequence')).toBeLessThan(
      source.indexOf('context.value = result')
    );
  });

  it('refreshes open, awaiting and uncertain windows after their expiry', () => {
    expect(source).toContain('const currentWindow = window.value;');
    expect(source).toContain("currentWindow?.state === 'open'");
    expect(source).toContain('currentWindow.service_window_expires_at');
    expect(source).toContain(
      "currentWindow?.state === 'awaiting_contact_reply'"
    );
    expect(source).toContain("currentWindow?.state === 'send_uncertain'");
    expect(source).toContain('currentWindow.awaiting_contact_reply_expires_at');
    expect(source).toContain('remaining + 350');
    expect(source).toContain('void refresh();');
  });

  it('cancels timers and in-flight ownership when reset or disposed', () => {
    expect(source).toContain('requestSequence += 1;');
    expect(source).toContain('clearExpirationTimer();');
    expect(source).toContain('onScopeDispose(reset);');
  });
});
