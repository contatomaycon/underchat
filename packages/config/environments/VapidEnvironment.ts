import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class VapidEnvironment {
  public get vapidPublicKey(): string {
    const publicKey = process.env.VAPID_PUBLIC_KEY;

    if (!publicKey) {
      throw new InvalidConfigurationError('VAPID_PUBLIC_KEY is not defined.');
    }

    return publicKey;
  }

  public get vapidPrivateKey(): string {
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!privateKey) {
      throw new InvalidConfigurationError('VAPID_PRIVATE_KEY is not defined.');
    }

    return privateKey;
  }

  public get vapidContactEmail(): string {
    return process.env.VAPID_CONTACT_EMAIL || 'noreply@underchat.com';
  }
}
