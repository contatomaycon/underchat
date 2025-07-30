import { injectable } from 'tsyringe';

@injectable()
export class BaileysHelpersService {
  constructor() {}

  getPhoneNumber(jid: string | undefined): string | undefined {
    if (!jid) return jid;

    const withoutSuffix = jid.includes(':')
      ? jid.split(':')[0]
      : jid.split('@')[0];

    return withoutSuffix.replace(/\D/g, '');
  }
}
