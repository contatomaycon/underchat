type PublicKeyCredentialWithJSON = PublicKeyCredential & {
  toJSON?: () => unknown;
};

type PublicKeyCredentialConstructorWithParser = typeof PublicKeyCredential & {
  parseRequestOptionsFromJSON?: (
    options: unknown
  ) => PublicKeyCredentialRequestOptions;
};

type JsonCredentialDescriptor = Omit<PublicKeyCredentialDescriptor, 'id'> & {
  id: string;
};

type JsonPublicKeyCredentialRequestOptions = Omit<
  PublicKeyCredentialRequestOptions,
  'allowCredentials' | 'challenge'
> & {
  allowCredentials?: JsonCredentialDescriptor[];
  challenge: string;
};

export function normalizePublicKeyOptions(
  input: unknown
): PublicKeyCredentialRequestOptions {
  const rawOptions = typeof input === 'string' ? JSON.parse(input) : input;

  if (!rawOptions || typeof rawOptions !== 'object') {
    throw new Error('PublicKeyCredentialRequestOptions invalido.');
  }

  const credentialConstructor =
    window.PublicKeyCredential as PublicKeyCredentialConstructorWithParser;

  if (typeof credentialConstructor.parseRequestOptionsFromJSON === 'function') {
    return credentialConstructor.parseRequestOptionsFromJSON(rawOptions);
  }

  const options = rawOptions as JsonPublicKeyCredentialRequestOptions;

  return {
    ...options,
    allowCredentials: options.allowCredentials?.map((credential) => ({
      ...credential,
      id: base64UrlToArrayBuffer(credential.id),
    })),
    challenge: base64UrlToArrayBuffer(options.challenge),
  };
}

export async function getPasskeyAssertion(
  publicKey: unknown
): Promise<unknown> {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    throw new Error('Este navegador nao oferece suporte a chave de acesso.');
  }

  const credential = (await navigator.credentials.get({
    publicKey: normalizePublicKeyOptions(publicKey),
  })) as PublicKeyCredentialWithJSON | null;

  if (!credential) {
    throw new Error('Nenhuma credencial de passkey foi retornada.');
  }

  return serializeCredential(credential);
}

export function serializeCredential(
  credential: PublicKeyCredentialWithJSON
): unknown {
  if (typeof credential.toJSON === 'function') {
    return credential.toJSON();
  }

  const response = credential.response;

  if (!(response instanceof AuthenticatorAssertionResponse)) {
    throw new Error('Resposta WebAuthn invalida.');
  }

  return {
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    response: {
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64Url(response.userHandle)
        : null,
    },
    type: credential.type,
  };
}

export function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '='
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
