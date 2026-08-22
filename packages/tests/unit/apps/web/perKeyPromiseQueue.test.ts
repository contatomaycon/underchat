type PromiseQueue = {
  run<T>(key: string, operation: () => Promise<T>): Promise<T>;
};

const { PerKeyPromiseQueue } =
  require('../../../../../apps/web/src/@webcore/utils/perKeyPromiseQueue') as {
    PerKeyPromiseQueue: new () => PromiseQueue;
  };

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('PerKeyPromiseQueue', () => {
  it('serializes one chat while allowing another chat to advance', async () => {
    const queue = new PerKeyPromiseQueue();
    const firstGate = deferred();
    const events: string[] = [];

    const large = queue.run('chat-1', async () => {
      events.push('chat-1:large:start');
      await firstGate.promise;
      events.push('chat-1:large:end');
    });
    const sameChatShort = queue.run('chat-1', async () => {
      events.push('chat-1:short');
    });
    const otherChatShort = queue.run('chat-2', async () => {
      events.push('chat-2:short');
    });

    await otherChatShort;
    expect(events).toEqual(['chat-1:large:start', 'chat-2:short']);

    firstGate.resolve();
    await Promise.all([large, sameChatShort]);
    expect(events).toEqual([
      'chat-1:large:start',
      'chat-2:short',
      'chat-1:large:end',
      'chat-1:short',
    ]);
  });

  it('continues the same chat after a rejected operation', async () => {
    const queue = new PerKeyPromiseQueue();
    const failure = queue.run('chat-1', async () => {
      throw new Error('expected_failure');
    });
    const successor = queue.run('chat-1', async () => 'accepted');

    await expect(failure).rejects.toThrow('expected_failure');
    await expect(successor).resolves.toBe('accepted');
  });
});
