import { generateProtocol } from '@core/common/functions/generateProtocol';

describe('generateProtocol', () => {
  it('builds protocol with date prefix and 7 random digits', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-21T10:00:00.000Z'));

    const randomSpy = jest
      .spyOn(crypto, 'getRandomValues')
      .mockImplementation((typedArray: ArrayBufferView<ArrayBufferLike>) => {
        const asUint32 = typedArray as Uint32Array;
        asUint32.set([10, 11, 12, 13, 14, 15, 16]);
        return typedArray;
      });

    try {
      expect(generateProtocol()).toBe('202604210123456');
    } finally {
      randomSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
