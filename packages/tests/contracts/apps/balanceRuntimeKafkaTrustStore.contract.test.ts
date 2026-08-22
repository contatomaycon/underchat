import fs from 'node:fs';
import path from 'node:path';

const dockerfilePath = path.join(
  process.cwd(),
  'apps',
  'balance_api',
  'Dockerfile'
);

function requiredIndex(source: string, token: string, fromIndex = 0): number {
  const index = source.indexOf(token, fromIndex);
  if (index < 0) {
    throw new Error(`Balance Dockerfile is missing required token: ${token}`);
  }
  return index;
}

function finalRuntimeStage(source: string): string {
  const stageMarker = '\nFROM ';
  const stageStart = source.lastIndexOf(stageMarker);
  if (stageStart < 0) {
    throw new Error('Balance Dockerfile does not define a final runtime stage');
  }
  return source.slice(stageStart + 1);
}

describe('Balance runtime Kafka TLS trust store', () => {
  it('installs, refreshes, and validates the system CA bundle', () => {
    const runtimeStage = finalRuntimeStage(
      fs.readFileSync(dockerfilePath, 'utf8')
    );
    const installStart = requiredIndex(
      runtimeStage,
      'apt-get install -y --no-install-recommends'
    );
    const installEnd = requiredIndex(runtimeStage, '&&', installStart);
    const installCommand = runtimeStage.slice(installStart, installEnd);
    const updateIndex = requiredIndex(
      runtimeStage,
      'update-ca-certificates',
      installEnd
    );
    const assertionIndex = requiredIndex(
      runtimeStage,
      'test -s /etc/ssl/certs/ca-certificates.crt',
      updateIndex
    );

    expect(installCommand).toContain('ca-certificates');
    expect(updateIndex).toBeGreaterThan(installEnd);
    expect(assertionIndex).toBeGreaterThan(updateIndex);
  });
});
