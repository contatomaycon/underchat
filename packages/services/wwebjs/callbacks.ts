let qrCodeResetCallback: (() => void) | undefined;
let connectionEstablishedCallback: (() => void) | undefined;

export function setQrCodeResetCallback(callback: () => void): void {
  qrCodeResetCallback = callback;
}

export function setConnectionEstablishedCallback(callback: () => void): void {
  connectionEstablishedCallback = callback;
}

export function triggerQrCodeReset(): void {
  qrCodeResetCallback?.();
}

export function triggerConnectionEstablished(): void {
  connectionEstablishedCallback?.();
}
