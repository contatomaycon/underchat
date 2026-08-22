import { buildForwardWorkerCommandOperationId } from '@core/common/functions/messageIdentity';

describe('forward worker command identity', () => {
  it('derives the documented target-scoped identity exactly', () => {
    expect(
      buildForwardWorkerCommandOperationId(
        '019a0000-0000-7000-8000-000000000001',
        '019a0000-0000-7000-8000-000000000002'
      )
    ).toBe('12073a3a83399a7812553d81c50c991085c2b5f0b063989441c4920e4642523f');
  });

  it('is stable per target and independent from request ordering', () => {
    const base = '019a0000-0000-7000-8000-000000000001';
    const targets = ['chat-b', 'chat-a'];
    const first = new Map(
      targets.map((target) => [
        target,
        buildForwardWorkerCommandOperationId(base, target),
      ])
    );
    const second = new Map(
      [...targets]
        .reverse()
        .map((target) => [
          target,
          buildForwardWorkerCommandOperationId(base, target),
        ])
    );

    expect(second).toEqual(first);
    expect(first.get('chat-a')).not.toBe(first.get('chat-b'));
  });
});
