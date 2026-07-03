import { Transform, type TransformCallback } from 'node:stream';
import type { preParsingHookHandler } from 'fastify';

type RawBodyStream = Transform & {
  receivedEncodedLength?: number;
};

export const captureRawBodyPreParsingHook: preParsingHookHandler = (
  request,
  _reply,
  payload,
  done
): void => {
  const chunks: Buffer[] = [];
  let receivedEncodedLength = 0;

  const rawBodyStream = new Transform({
    transform(
      this: RawBodyStream,
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: TransformCallback
    ): void {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      chunks.push(buffer);
      receivedEncodedLength += buffer.length;
      this.receivedEncodedLength = receivedEncodedLength;

      callback(null, chunk);
    },
    flush(callback: TransformCallback): void {
      request.rawBody = Buffer.concat(chunks);
      callback();
    },
  }) as RawBodyStream;

  payload.on('error', (error) => {
    rawBodyStream.destroy(error);
  });

  done(null, payload.pipe(rawBodyStream));
};
