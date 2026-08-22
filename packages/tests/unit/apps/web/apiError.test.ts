import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'apps/web/src/utils/apiError.ts'),
  'utf8'
);

describe('web API error metadata contract', () => {
  it('recognizes the authoritative official-window refresh conflict', () => {
    expect(source).toContain("'official_window_requires_template_refresh'");
    expect(source).toContain('getApiErrorStatus(error) === 409');
    expect(source).toContain('getApiErrorReason(error) ===');
    expect(source).toContain('payload?.data?.reason');
  });

  it('exposes request ids from payloads and response headers', () => {
    expect(source).toContain('id?: unknown;');
    expect(source).toContain('asNonEmptyString(payload?.id) ??');
    expect(source.indexOf('payload?.id')).toBeLessThan(
      source.indexOf('payload?.data?.request_id')
    );
    expect(source).toContain('payload?.data?.request_id');
    expect(source).toContain('payload?.request_id');
    expect(source).toContain("headers?.['x-request-id']");
    expect(source).toContain("headers?.['x-correlation-id']");
  });
});
