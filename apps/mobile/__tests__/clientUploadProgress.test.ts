import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetToken = jest.fn<() => Promise<string | null>>();
const mockRefreshSessionTokenWithSingleFlight =
  jest.fn<() => Promise<string | null>>();
const mockTeardownMobileSessionOnUnauthorized = jest.fn<() => Promise<void>>();
const mockEmitAttendanceBlocked = jest.fn();

jest.mock('../config', () => ({ BACKEND_URL: 'https://api.test' }));
jest.mock('../storage/authStorage', () => ({ getToken: mockGetToken }));
jest.mock('../api/sessionRefresh', () => ({
  refreshSessionTokenWithSingleFlight: mockRefreshSessionTokenWithSingleFlight,
}));
jest.mock('../utils/sessionTeardown', () => ({
  teardownMobileSessionOnUnauthorized: mockTeardownMobileSessionOnUnauthorized,
}));
jest.mock('../utils/authEvents', () => ({
  emitAttendanceBlocked: mockEmitAttendanceBlocked,
}));

import { apiPostFormWithMessage } from '../api/client';

type ProgressPayload = {
  lengthComputable: boolean;
  loaded: number;
  total: number;
};

const xhrRequests: MockXMLHttpRequest[] = [];

class MockXMLHttpRequest {
  method = '';
  url = '';
  timeout = 0;
  body: FormData | null = null;
  status = 0;
  responseText = '';
  headers: Record<string, string> = {};
  upload: { onprogress: ((event: ProgressPayload) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() {
    xhrRequests.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: FormData) {
    this.body = body;
  }

  emitProgress(event: ProgressPayload) {
    this.upload.onprogress?.(event);
  }

  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }

  fail() {
    this.onerror?.();
  }
}

async function waitForXhr(index = 0): Promise<MockXMLHttpRequest> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Promise.resolve();
    const request = xhrRequests[index];
    if (request) return request;
  }

  throw new Error(`XHR request ${index} was not created`);
}

describe('apiPostFormWithMessage upload progress', () => {
  beforeEach(() => {
    xhrRequests.length = 0;
    mockGetToken.mockReset();
    mockRefreshSessionTokenWithSingleFlight.mockReset();
    mockTeardownMobileSessionOnUnauthorized.mockReset();
    mockEmitAttendanceBlocked.mockReset();
    mockGetToken.mockResolvedValue('old-token');
    mockRefreshSessionTokenWithSingleFlight.mockResolvedValue('new-token');
    mockTeardownMobileSessionOnUnauthorized.mockResolvedValue();
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest =
      MockXMLHttpRequest;
  });

  it('calculates upload progress, caps at 99, and parses success', async () => {
    const progressValues: number[] = [];

    const resultPromise = apiPostFormWithMessage<{ message_id: string }>(
      '/upload',
      {} as FormData,
      {
        timeoutMs: 1234,
        onUploadProgress: (progress) => progressValues.push(progress),
      }
    );

    const xhr = await waitForXhr();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://api.test/v1/upload');
    expect(xhr.timeout).toBe(1234);
    expect(xhr.headers.Authorization).toBe('Bearer old-token');

    xhr.emitProgress({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.emitProgress({ lengthComputable: true, loaded: 100, total: 100 });
    xhr.respond(200, {
      status: true,
      data: { message_id: 'message-1' },
      message: 'ok',
    });

    await expect(resultPromise).resolves.toEqual({
      status: true,
      data: { message_id: 'message-1' },
      message: 'ok',
      requestId: null,
      httpStatus: 200,
    });
    expect(progressValues).toEqual([50, 99]);
  });

  it('returns null when the XHR upload fails', async () => {
    const resultPromise = apiPostFormWithMessage('/upload', {} as FormData, {
      onUploadProgress: jest.fn(),
    });

    const xhr = await waitForXhr();
    xhr.fail();

    await expect(resultPromise).resolves.toBeNull();
  });

  it('retries with a refreshed token after 401 and resets progress', async () => {
    const progressValues: number[] = [];

    const resultPromise = apiPostFormWithMessage<{ message_id: string }>(
      '/upload',
      {} as FormData,
      { onUploadProgress: (progress) => progressValues.push(progress) }
    );

    const firstXhr = await waitForXhr(0);
    firstXhr.respond(401, { status: false, message: 'unauthorized' });

    const secondXhr = await waitForXhr(1);
    expect(mockRefreshSessionTokenWithSingleFlight).toHaveBeenCalledTimes(1);
    expect(firstXhr.headers.Authorization).toBe('Bearer old-token');
    expect(secondXhr.headers.Authorization).toBe('Bearer new-token');
    expect(progressValues).toEqual([0]);

    secondXhr.emitProgress({ lengthComputable: true, loaded: 1, total: 4 });
    secondXhr.respond(200, {
      status: true,
      data: { message_id: 'message-2' },
    });

    await expect(resultPromise).resolves.toEqual({
      status: true,
      data: { message_id: 'message-2' },
      message: null,
      requestId: null,
      httpStatus: 200,
    });
    expect(progressValues).toEqual([0, 25]);
  });
});
