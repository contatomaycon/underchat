import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspaceRoot = process.cwd();
const helperPath = path.resolve(
  workspaceRoot,
  'scripts/lib/baileys-live-pairing-lifecycle.mjs'
);
const runnerPath = path.resolve(
  workspaceRoot,
  'scripts/verify-live-baileys-postgres-pairing.mjs'
);
const helperUrl = pathToFileURL(helperPath).href;

function runModuleTest(body: string): void {
  const source = `
    import assert from 'node:assert/strict';
    import {
      closeBaileysSocket,
      createCredsPersistenceQueue,
      quiesceBaileysForHandoff,
    } from ${JSON.stringify(helperUrl)};
    ${body}
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    stdio: 'pipe',
    timeout: 5_000,
  });
}

describe('Baileys live PostgreSQL pairing lifecycle', () => {
  it('awaits the public async socket end path and its websocket fallback', () => {
    runModuleTest(`
      const order = [];
      let releaseEnd;
      const endGate = new Promise(resolve => { releaseEnd = resolve; });
      const closing = closeBaileysSocket({
        end: async () => {
          order.push('end:start');
          await endGate;
          order.push('end:done');
        },
      }, new Error('test-close'));
      await Promise.resolve();
      assert.deepEqual(order, ['end:start']);
      releaseEnd();
      assert.equal(await closing, true);
      assert.deepEqual(order, ['end:start', 'end:done']);

      let fallbackClosed = false;
      assert.equal(await closeBaileysSocket({
        end: async () => { throw new Error('end-failed'); },
        ws: { close: async () => { fallbackClosed = true; } },
      }, new Error('test-fallback')), true);
      assert.equal(fallbackClosed, true);
    `);
  });

  it('serializes a growing credential tail and detaches every restarted socket', () => {
    runModuleTest(`
      class Emitter {
        listeners = new Set();
        on(_event, listener) { this.listeners.add(listener); }
        off(_event, listener) { this.listeners.delete(listener); }
        emit() { for (const listener of [...this.listeners]) listener(); }
      }

      let releaseFirst;
      const firstGate = new Promise(resolve => { releaseFirst = resolve; });
      let calls = 0;
      let active = 0;
      let maxActive = 0;
      const queue = createCredsPersistenceQueue(async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (calls === 1) await firstGate;
        active -= 1;
      });
      const firstSocket = new Emitter();
      const restartedSocket = new Emitter();
      queue.attach(firstSocket);
      queue.attach(restartedSocket);
      firstSocket.emit();
      const draining = queue.drain();
      await Promise.resolve();
      restartedSocket.emit();
      queue.stopAccepting();
      firstSocket.emit();
      restartedSocket.emit();
      releaseFirst();
      await draining;

      assert.equal(calls, 2);
      assert.equal(maxActive, 1);
      assert.equal(firstSocket.listeners.size, 0);
      assert.equal(restartedSocket.listeners.size, 0);
      assert.equal(queue.enqueue(), false);
      const lateSocket = new Emitter();
      assert.equal(queue.attach(lateSocket), false);
      assert.equal(lateSocket.listeners.size, 0);
    `);
  });

  it('closes and drains before the final save, checkpoint and fence', () => {
    runModuleTest(`
      class Emitter {
        listeners = new Set();
        on(_event, listener) { this.listeners.add(listener); }
        off(_event, listener) { this.listeners.delete(listener); }
        emit() { for (const listener of [...this.listeners]) listener(); }
      }

      const order = [];
      let eventSaveCount = 0;
      const emitter = new Emitter();
      const queue = createCredsPersistenceQueue(async () => {
        eventSaveCount += 1;
        order.push('event-save');
      });
      queue.attach(emitter);
      const auth = {
        saveCreds: async () => { order.push('final-save'); },
        prepareHandoff: async () => {
          order.push('checkpoint');
          return { records: [{}], sizeBytes: 1 };
        },
        assertFence: async () => { order.push('fence'); },
      };
      const socket = {
        end: async () => {
          order.push('close:start');
          emitter.emit();
          await Promise.resolve();
          order.push('close:done');
        },
      };

      const checkpoint = await quiesceBaileysForHandoff({
        auth,
        credsPersistence: queue,
        socket,
        closeError: new Error('test-handoff'),
      });
      assert.deepEqual(order, [
        'close:start',
        'close:done',
        'final-save',
        'checkpoint',
        'fence',
      ]);
      assert.equal(eventSaveCount, 0);
      assert.equal(checkpoint.sizeBytes, 1);
    `);
  });

  it('keeps the live runner on the quiesced handoff path', () => {
    const runner = fs.readFileSync(runnerPath, 'utf8');
    expect(runner).toContain('await quiesceBaileysForHandoff({');
    expect(runner).toContain('await auth.closeForHandoff();');
    expect(runner).not.toContain('await auth.checkpoint();');
  });
});
