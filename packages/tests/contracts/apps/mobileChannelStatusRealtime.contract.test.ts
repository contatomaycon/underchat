import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('mobile channel status realtime bootstrap', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'apps/mobile/context/ChannelStatusContext.tsx'),
    'utf8'
  );
  const locale = readFileSync(
    resolve(process.cwd(), 'apps/mobile/locales/pt.ts'),
    'utf8'
  );
  const sidebar = readFileSync(
    resolve(process.cwd(), 'apps/mobile/components/UserSidebar.tsx'),
    'utf8'
  );

  it('hydrates the native order high-watermark from the all-channel HTTP snapshot', () => {
    expect(source).toContain('channel.connection_status_order');
    expect(source).toContain('nativeStatusOrderByIdRef.current.set');
  });

  it('hydrates persisted type and generation fences before applying realtime', () => {
    expect(source).toContain('channelWorkerTypeByIdRef.current.get');
    expect(source).toContain('channelRuntimeGenerationByIdRef.current.get');
    expect(source).toContain('currentWorkerTypeId:');
    expect(source).toContain('currentRuntimeGeneration:');
  });

  it('subscribes first, loads HTTP truth and only then replays buffered events', () => {
    const subscribeAt = source.indexOf(
      'await initializeChannelStatusSocket(accountId)'
    );
    const snapshotAt = source.indexOf('await Promise.all([', subscribeAt);
    const readyAt = source.indexOf('initialSnapshotReady = true', snapshotAt);
    const replayAt = source.indexOf(
      'for (const payload of bufferedStatusEvents.splice(0))',
      readyAt
    );

    expect(subscribeAt).toBeGreaterThan(-1);
    expect(snapshotAt).toBeGreaterThan(subscribeAt);
    expect(readyAt).toBeGreaterThan(snapshotAt);
    expect(replayAt).toBeGreaterThan(readyAt);
  });

  it('retries a failed initial realtime subscription with bounded backoff', () => {
    expect(source).toContain('BOOTSTRAP_RETRY_BASE_DELAY_MS');
    expect(source).toContain('BOOTSTRAP_RETRY_MAX_DELAY_MS');
    expect(source).toContain('if (isCurrent()) runBootstrap()');
    expect(source).toContain('clearTimeout(bootstrapRetryTimer)');
  });

  it('projects lifecycle IDs to customer-facing channel labels', () => {
    expect(locale).toContain("channel_online: 'Conectado'");
    expect(locale).toContain(
      "channel_awaiting_qr: 'Aguardando leitura do QR code'"
    );
    expect(source).toContain('[EWorkerStatus.online]: pt.channel_online');
    expect(source).toContain('pt.channel_awaiting_qr');
    expect(sidebar).toContain(
      "if (connectionStatus === 'qr') return pt.channel_awaiting_qr"
    );
  });
});
