import fs from 'node:fs';
import path from 'node:path';

const WEB_ROOT = path.resolve(process.cwd(), 'apps/web/src');
const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(WEB_ROOT, relativePath), 'utf8');

describe('chat recorded audio preview contract', () => {
  const chatSource = readSource('pages/chat.vue');
  const previewSource = readSource(
    'components/chat/ChatRecordedAudioPreview.vue'
  );

  it('finishes recordings into a local preview instead of sending immediately', () => {
    const finalizeStart = chatSource.indexOf('const finalizeAudioRecording');
    const previewSendStart = chatSource.indexOf('const sendRecordedAudioPreview');
    const finalizeSource = chatSource.slice(finalizeStart, previewSendStart);

    expect(finalizeSource).toContain('shouldPersistRecording.value = true;');
    expect(finalizeSource).toContain('stopAudioRecordingInternal(savedMsg, savedReply);');
    expect(finalizeSource).not.toContain('sendAudioMessage(');
    expect(chatSource).toContain('<ChatRecordedAudioPreview');
    expect(chatSource).toContain('@send="sendRecordedAudioPreview"');
  });

  it('sends only from the preview and closes it before the upload resolves', () => {
    const sendStart = chatSource.indexOf('const sendRecordedAudioPreview');
    const sendEnd = chatSource.indexOf('const togglePauseAudioRecording');
    const sendSource = chatSource.slice(sendStart, sendEnd);

    expect(sendSource).toContain('await sendAudioMessage(');
    expect(sendSource).toContain('clearRecordedAudioPreview();');
    expect(sendSource).toContain('chatStore.clearMessageReply();');
    expect(sendSource.indexOf('clearRecordedAudioPreview();')).toBeLessThan(
      sendSource.indexOf('await sendAudioMessage(')
    );
  });

  it('cleans preview object URLs on discard, a new recording, and unmount', () => {
    expect(chatSource).toContain('URL.revokeObjectURL(recordedAudioUrl.value);');
    expect(chatSource).toContain('const discardRecordedAudioPreview');
    expect(chatSource).toContain('clearRecordedAudioPreview();\n  releaseAudioResources();');
    expect(chatSource).toContain('onBeforeUnmount(() => {');
    expect(chatSource).toContain('cancelAudioRecording();\n  clearRecordedAudioPreview();');
  });

  it('provides playback controls and explicit parent events', () => {
    expect(previewSource).toContain("'update:viewOnce': [value: boolean]");
    expect(previewSource).toContain("@click=\"emit('discard')\"");
    expect(previewSource).toContain("@click=\"emit('send')\"");
    expect(previewSource).toContain('@click="togglePlayback"');
    expect(previewSource).toContain('@timeupdate="onTimeUpdate"');
    expect(previewSource).toContain('onBeforeUnmount(resetPlayer);');
  });
});
