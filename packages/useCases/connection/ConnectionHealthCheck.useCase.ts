import { injectable } from 'tsyringe';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

@injectable()
export class ConnectionHealthCheckUseCase {
  constructor(private readonly baileysService: BaileysService) {}

  async execute(): Promise<{ httpStatusCode: EHTTPStatusCode }> {
    const status = this.baileysService.getStatus();

    if (status === EBaileysConnectionStatus.disconnected) {
      this.baileysService.reconnect({
        initial_connection: false,
      });
    }

    return {
      httpStatusCode:
        status === EBaileysConnectionStatus.connected
          ? EHTTPStatusCode.ok
          : EHTTPStatusCode.internal_server_error,
    };
  }
}

