const isFunction = (value) => typeof value === 'function';

/**
 * Serializes credential persistence without losing failures. `drain()` follows
 * a tail that grows while it is being awaited, and `stopAccepting()` closes and
 * detaches every listener synchronously before the final drain.
 */
export const createCredsPersistenceQueue = (saveCreds) => {
  if (!isFunction(saveCreds)) {
    throw new TypeError('saveCreds must be a function');
  }

  let accepting = true;
  let tail = Promise.resolve();
  const registrations = new Map();

  const enqueue = () => {
    if (!accepting) return false;

    const scheduled = tail.then(() => saveCreds());
    // Keep the failure observable through drain(), without allowing an event
    // callback to create a transient unhandled rejection.
    void scheduled.catch(() => {});
    tail = scheduled;
    return true;
  };

  const attach = (emitter) => {
    if (!emitter || !isFunction(emitter.on) || !isFunction(emitter.off)) {
      throw new TypeError('credential emitter must expose on() and off()');
    }
    if (!accepting) return false;
    if (registrations.has(emitter)) return true;

    const listener = () => {
      enqueue();
    };
    registrations.set(emitter, listener);
    emitter.on('creds.update', listener);
    return true;
  };

  const stopAccepting = () => {
    if (!accepting) return;
    accepting = false;
    for (const [emitter, listener] of registrations) {
      try {
        emitter.off('creds.update', listener);
      } catch {
        // The socket may already have destroyed its emitter during reconnect.
      }
    }
    registrations.clear();
  };

  const drain = async () => {
    while (true) {
      const observedTail = tail;
      await observedTail;
      // Allow an event callback already queued as a microtask to extend tail.
      await Promise.resolve();
      if (observedTail === tail) return;
    }
  };

  return {
    attach,
    drain,
    enqueue,
    stopAccepting,
  };
};

/**
 * Closes a Baileys socket and waits for its async end handlers. The raw
 * websocket is only a fallback when the public end() path rejects or is absent.
 */
export const closeBaileysSocket = async (socket, error) => {
  if (!socket) return false;

  let endError;
  if (isFunction(socket.end)) {
    try {
      await socket.end(error);
      return true;
    } catch (caught) {
      endError = caught;
    }
  }

  if (isFunction(socket.ws?.close)) {
    try {
      await socket.ws.close();
      return true;
    } catch (caught) {
      throw new AggregateError(
        endError === undefined ? [caught] : [endError, caught],
        'baileys_canary_socket_close_failed'
      );
    }
  }

  if (endError !== undefined) throw endError;
  return false;
};

/**
 * Establishes the irreversible handoff boundary: no new credential callbacks,
 * transport fully closed, queued saves drained, final credentials persisted,
 * writes paused/drained by the native store, then checkpointed and fenced.
 */
export const quiesceBaileysForHandoff = async ({
  auth,
  credsPersistence,
  socket,
  closeError,
}) => {
  credsPersistence.stopAccepting();
  const closed = await closeBaileysSocket(socket, closeError);
  if (!closed) throw new Error('baileys_canary_socket_close_unavailable');

  await credsPersistence.drain();
  await auth.saveCreds();
  const checkpoint = await auth.prepareHandoff();
  await auth.assertFence();
  return checkpoint;
};
