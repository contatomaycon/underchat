import {
  canUseChannelForTransferAndForwarding,
  filterChannelsForTransferAndForwarding,
} from '@core/common/functions/transferAndForwardChannelAccess';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';

const userChannels = [{ id: 'worker-1', name: 'Varejo' }];
const workers = [
  { id: 'worker-1', name: 'Varejo' },
  { id: 'worker-2', name: 'Atacado' },
];

describe('transferAndForwardChannelAccess', () => {
  it('keeps direct-channel filtering without the permission', () => {
    expect(
      filterChannelsForTransferAndForwarding(workers, userChannels)
    ).toEqual([{ id: 'worker-1', name: 'Varejo' }]);
    expect(
      canUseChannelForTransferAndForwarding('worker-2', userChannels)
    ).toBe(false);
  });

  it('allows every channel with the transfer and forwarding permission', () => {
    const actions = [
      {
        action_name:
          EWorkerPermissions.view_all_channels_for_transfer_and_forwarding,
      },
    ];

    expect(
      filterChannelsForTransferAndForwarding(
        workers,
        userChannels,
        actions as never
      )
    ).toEqual(workers);
    expect(
      canUseChannelForTransferAndForwarding(
        'worker-2',
        userChannels,
        actions as never
      )
    ).toBe(true);
  });

  it('keeps unrestricted-channel users unrestricted', () => {
    expect(filterChannelsForTransferAndForwarding(workers)).toEqual(workers);
    expect(canUseChannelForTransferAndForwarding('worker-2')).toBe(true);
  });
});
