import {
  downloadMediaBuffer,
  isPermanentMediaDownloadError,
  MediaDownloadHttpError,
  MediaDownloadInvalidUrlError,
  MediaDownloadNetworkError,
  MediaDownloadSizeLimitError,
  MediaDownloadTimeoutError,
} from '@core/common/functions/downloadMediaBuffer';

describe('downloadMediaBuffer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('aborts a stalled response body and awaits the original download failure', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_input, init) => {
        requestSignal = init?.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'image/jpeg',
          }),
          arrayBuffer: jest.fn(
            () =>
              new Promise<ArrayBuffer>((_resolve, reject) => {
                requestSignal?.addEventListener(
                  'abort',
                  () => reject(requestSignal?.reason),
                  { once: true }
                );
              })
          ),
        } as never;
      });

    const download = downloadMediaBuffer('https://storage.test/image.jpg', {
      timeoutMs: 25,
    });
    const rejected = expect(download).rejects.toBeInstanceOf(
      MediaDownloadTimeoutError
    );

    await jest.advanceTimersByTimeAsync(25);
    await rejected;

    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.test/image.jpg',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it('rejects an oversized declared body before buffering it', async () => {
    const cancel = jest.fn(async () => undefined);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-length': '9',
        'content-type': 'application/octet-stream',
      }),
      body: { cancel },
    } as never);

    await expect(
      downloadMediaBuffer('https://storage.test/oversized.bin', {
        maxBytes: 8,
      })
    ).rejects.toMatchObject({
      name: 'MediaDownloadSizeLimitError',
      maxBytes: 8,
      observedBytes: 9,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, true],
    [413, true],
    [408, false],
    [425, false],
    [429, false],
    [503, false],
  ])(
    'classifies HTTP %d deterministically for pre-provider retry policy',
    async (status, permanent) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status,
        headers: new Headers(),
      } as never);

      const outcome = await downloadMediaBuffer(
        `https://storage.test/status-${status}`
      ).catch((error: unknown) => error);

      expect(outcome).toBeInstanceOf(MediaDownloadHttpError);
      expect(isPermanentMediaDownloadError(outcome)).toBe(permanent);
    }
  );

  it('classifies size limits as permanent and timeouts as transient', () => {
    expect(
      isPermanentMediaDownloadError(new MediaDownloadSizeLimitError(8, 9))
    ).toBe(true);
    expect(
      isPermanentMediaDownloadError(new MediaDownloadTimeoutError(25))
    ).toBe(false);
  });

  it.each(['ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN'])(
    'normalizes %s transport failures as retryable media download errors',
    async (code) => {
      const transportError = Object.assign(new Error(`transport ${code}`), {
        code,
      });
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(transportError);

      await expect(
        downloadMediaBuffer('https://storage.test/network.bin')
      ).rejects.toMatchObject({
        name: 'MediaDownloadNetworkError',
        retryable: true,
        originalCause: transportError,
      });
    }
  );

  it('normalizes a response-body stream reset as retryable', async () => {
    const bodyError = new Error('response body terminated');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(bodyError);
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body,
    } as never);

    await expect(
      downloadMediaBuffer('https://storage.test/body-reset.bin')
    ).rejects.toMatchObject({
      name: 'MediaDownloadNetworkError',
      retryable: true,
      originalCause: bodyError,
    });
  });

  it.each(['not a URL', 'ftp://storage.test/file.bin', ''])(
    'classifies an invalid media URL %p as permanent before fetch',
    async (url) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch');

      const outcome = await downloadMediaBuffer(url).catch(
        (error: unknown) => error
      );

      expect(outcome).toBeInstanceOf(MediaDownloadInvalidUrlError);
      expect(isPermanentMediaDownloadError(outcome)).toBe(true);
      expect(outcome).not.toBeInstanceOf(MediaDownloadNetworkError);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('stops a chunked body that exceeds the limit without content-length', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
        controller.enqueue(Uint8Array.from([5, 6, 7, 8, 9]));
        controller.close();
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/octet-stream',
      }),
      body,
    } as never);

    await expect(
      downloadMediaBuffer('https://storage.test/chunked.bin', {
        maxBytes: 8,
      })
    ).rejects.toBeInstanceOf(MediaDownloadSizeLimitError);
  });

  it('does not wait for an uncooperative body cancellation after proving the limit', async () => {
    const cancel = jest.fn(() => new Promise<void>(() => undefined));
    const releaseLock = jest.fn();
    const read = jest.fn().mockResolvedValue({
      done: false,
      value: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/octet-stream',
      }),
      body: {
        getReader: () => ({
          read,
          cancel,
          releaseLock,
        }),
      },
    } as never);

    let deadline: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      downloadMediaBuffer('https://storage.test/uncooperative.bin', {
        maxBytes: 8,
      }).then(
        () => ({ kind: 'resolved' as const }),
        (error) => ({ kind: 'rejected' as const, error })
      ),
      new Promise<{ kind: 'deadline' }>((resolve) => {
        deadline = setTimeout(() => resolve({ kind: 'deadline' }), 250);
      }),
    ]);
    if (deadline) clearTimeout(deadline);

    expect(outcome).toMatchObject({
      kind: 'rejected',
      error: expect.any(MediaDownloadSizeLimitError),
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('returns a bounded chunked body and its metadata', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2]));
        controller.enqueue(Uint8Array.from([3, 4]));
        controller.close();
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'image/jpeg',
        'content-disposition': 'attachment; filename="photo.jpg"',
      }),
      body,
    } as never);

    await expect(
      downloadMediaBuffer('https://storage.test/photo.jpg', { maxBytes: 8 })
    ).resolves.toEqual({
      buffer: Buffer.from([1, 2, 3, 4]),
      contentType: 'image/jpeg',
      contentLength: undefined,
      filename: 'photo.jpg',
    });
  });

  it('keeps a completed download successful when filename*= has invalid percent encoding', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'image/jpeg',
        'content-disposition':
          "attachment; filename*=UTF-8''broken-%E0%A4%A.jpg",
      }),
      body: null,
      arrayBuffer: jest.fn(async () => Uint8Array.from([1, 2]).buffer),
    } as never);

    await expect(
      downloadMediaBuffer('https://storage.test/header.jpg')
    ).resolves.toEqual({
      buffer: Buffer.from([1, 2]),
      contentType: 'image/jpeg',
      contentLength: undefined,
      filename: 'broken-%E0%A4%A.jpg',
    });
  });
});
