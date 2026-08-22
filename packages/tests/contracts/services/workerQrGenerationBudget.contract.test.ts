import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('worker QR generation budget contract', () => {
  it.each([
    [
      'Baileys',
      'packages/services/baileys/methods/connection.service.ts',
      'private readonly maxQrGenerations = 5;',
    ],
    [
      'WWebJS',
      'packages/services/wwebjs/methods/connection.service.ts',
      'const MAX_QR_GENERATIONS = 5;',
    ],
    [
      'WhatsMeow',
      'apps/worker_whatsmeow/internal/app/whatsapp.go',
      'maxQRCodeGenerations                                      = 5',
    ],
  ])('%s permits five automatic QR generations', (_provider, path, marker) => {
    expect(read(path)).toContain(marker);
  });

  it('keeps the UI exhaustion state driven by provider attempt metadata', () => {
    const modal = read('apps/web/src/components/channel/AppConnectChannel.vue');
    expect(modal).toContain('qrAttempt.value > qrMaxAttempts.value');
    expect(modal).toContain('isQrAttemptsExpired');
    expect(modal).toContain('showQrRestartAction');
  });

  it('binds every provider lifecycle to the same five-QR terminal contract', () => {
    const baileys = read(
      'packages/services/baileys/methods/connection.service.ts'
    );
    const wwebjs = read(
      'packages/services/wwebjs/methods/connection.service.ts'
    );
    const whatsmeow = read('apps/worker_whatsmeow/internal/app/whatsapp.go');
    const whatsmeowQrChannel = read(
      'apps/worker_whatsmeow/forks/whatsmeow/qrchan.go'
    );

    expect(baileys).toContain('this.scheduleQrRenewal(id, this.qrHash);');
    expect(baileys).toContain(
      'this.qrGenerationCount >= this.maxQrGenerations'
    );
    expect(wwebjs).toContain('qrMaxRetries: MAX_QR_GENERATIONS');
    expect(wwebjs).toContain('this.handleQrGenerationLimitReached();');
    expect(whatsmeow).toContain(
      'attempt, allowed, duplicate, current := m.recordQRCodeGenerationForSession('
    );
    expect(whatsmeow).toContain(
      'if !m.isQRCodeReadSessionCurrent(qrReadSessionSerial, connectionAttemptID)'
    );
    expect(whatsmeow).toContain('if !current {');
    expect(whatsmeowQrChannel).toContain(
      'automatically outputs a new QR code when the previous one expires'
    );
  });
});
