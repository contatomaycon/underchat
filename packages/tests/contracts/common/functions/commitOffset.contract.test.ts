import {
  commitOffset,
  isRecoverableCommitOffsetError,
} from '@core/common/functions/commitOffset';

describe('commitOffset', () => {
  it('commits the next offset', async () => {
    const consumer = {
      commitSync: jest.fn(),
    };

    await commitOffset(consumer as never, 'topic-a', 2, 41);

    expect(consumer.commitSync).toHaveBeenCalledWith([
      {
        topic: 'topic-a',
        partition: 2,
        offset: 42,
      },
    ]);
  });

  it('treats disconnected consumer commits as recoverable', async () => {
    const consumer = {
      commitSync: jest.fn(() => {
        throw new Error('Kafka consumer is not connected');
      }),
    };

    await expect(
      commitOffset(consumer as never, 'topic-a', 2, 41)
    ).resolves.toBeUndefined();
  });

  it('treats stale group generation commits as recoverable', async () => {
    const error = new Error(
      'Broker: Specified group generation id is not valid'
    ) as Error & { code: number };
    error.code = 22;

    expect(isRecoverableCommitOffsetError(error)).toBe(true);
  });

  it('rejects non-recoverable commit failures', async () => {
    const consumer = {
      commitSync: jest.fn(() => {
        throw new Error('disk exploded');
      }),
    };

    await expect(
      commitOffset(consumer as never, 'topic-a', 2, 41)
    ).rejects.toThrow('disk exploded');
  });
});
