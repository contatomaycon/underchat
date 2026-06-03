import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';

const NOTIFICATION_SOUND = require('../assets/notification-chime.wav');

let player: AudioPlayer | null = null;
let audioModePromise: Promise<void> | null = null;

function ensurePlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(NOTIFICATION_SOUND, {
      downloadFirst: true,
      keepAudioSessionActive: true,
      updateInterval: 1000,
    });
    player.volume = 0.72;
  }

  return player;
}

function ensureAudioMode(): Promise<void> {
  if (!audioModePromise) {
    audioModePromise = setAudioModeAsync({
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
    }).catch(() => {});
  }

  return audioModePromise;
}

export async function playInAppNotificationSound(): Promise<void> {
  try {
    await ensureAudioMode();
    const sound = ensurePlayer();
    if (sound.currentTime > 0 || sound.playing) {
      await sound.seekTo(0).catch(() => {});
    }
    sound.play();
  } catch {
    // Notification sound is best-effort only.
  }
}

export function releaseInAppNotificationSound(): void {
  if (!player) return;
  player.remove();
  player = null;
}
