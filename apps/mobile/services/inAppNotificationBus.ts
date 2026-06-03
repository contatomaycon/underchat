export type InAppNotificationPayload = {
  id?: string;
  title: string;
  body: string;
  icon?: string;
  onPress?: () => void;
};

type InAppNotificationListener = (
  notification: InAppNotificationPayload
) => void;

const listeners = new Set<InAppNotificationListener>();

export function addInAppNotificationListener(
  listener: InAppNotificationListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitInAppNotification(
  notification: InAppNotificationPayload
): void {
  for (const listener of listeners) {
    try {
      listener(notification);
    } catch {
      // Ignore listener errors so notification delivery cannot break the app.
    }
  }
}
