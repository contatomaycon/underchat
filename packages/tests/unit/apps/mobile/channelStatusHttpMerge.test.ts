import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { mergeWhatsappOrderedChannelHttpSnapshot } from '@core/common/functions/whatsappConnectionStatus';

describe('mobile channel status HTTP/realtime merge', () => {
  it('keeps a newer realtime ONLINE projection when a delayed HTTP response arrives', () => {
    const realtime = {
      id: 'worker-1',
      name: 'Support',
      status: { id: EWorkerStatus.online, name: 'Online' },
      worker_status_observed_at: '2026-08-07T12:00:20.000Z',
      connection_status: 'online',
      connection_status_order: '20',
      connection_online_acknowledged: true,
    };
    const delayedHttp = {
      id: 'worker-1',
      name: 'Support',
      status: { id: EWorkerStatus.offline, name: 'Offline' },
      worker_status_observed_at: '2026-08-07T12:00:19.000Z',
      connection_status: 'connecting',
      connection_status_order: '19',
      connection_online_acknowledged: false,
    };

    expect(
      mergeWhatsappOrderedChannelHttpSnapshot(
        [realtime],
        [delayedHttp],
        new Map([['worker-1', '10']])
      )
    ).toEqual([realtime]);
  });

  it('keeps a newer realtime OFFLINE row omitted by the delayed HTTP response', () => {
    const realtime = {
      id: 'worker-1',
      name: 'Support',
      status: { id: EWorkerStatus.offline, name: 'Offline' },
      connection_status: 'qr',
      connection_status_order: '31',
    };

    expect(
      mergeWhatsappOrderedChannelHttpSnapshot(
        [realtime],
        [],
        new Map([['worker-1', '30']])
      )
    ).toEqual([realtime]);
  });
});
