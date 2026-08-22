import fs from 'node:fs';
import path from 'node:path';

const component = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'apps/web/src/components/channel/AppConnectChannel.vue'
  ),
  'utf8'
);

describe('AppConnectChannel secure connection QR fence', () => {
  it('invalidates QR work as soon as a secure connection lifecycle starts', () => {
    expect(component).toContain('beginSecureConnectionLifecycleFence();');
    expect(component).toContain('qrRequestGeneration += 1;');
    expect(component).toContain('secureConnectionLifecycleFence.value ||');
  });

  it('keeps the fence through successful import and releases only for terminal failure or an explicit lifecycle reset', () => {
    expect(component).toContain(
      "if (['failed', 'expired', 'cancelled'].includes(nextSession.status))"
    );
    expect(component).toContain('if (sessionRemoved) {');
    expect(component).toContain('if (channelChanged) {');
    expect(component).toContain('releaseSecureConnectionLifecycleFence();');
  });
});
