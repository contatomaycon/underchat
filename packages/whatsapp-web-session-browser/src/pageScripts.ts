import type {
  WhatsAppPageContext,
  WhatsAppWebAuthDump,
} from './sessionPackage';

export type WhatsAppReadinessSnapshot = {
  authenticated: boolean;
  hasBlockingLoginUi: boolean;
  hasChatUi: boolean;
  readyForHandoff: boolean;
  reason: string;
  syncing: boolean;
};

type JsonRecord = Record<string, unknown>;
type KeyPairBytes = {
  private: Uint8Array;
  public: Uint8Array;
};

export function readWhatsAppReadiness(): WhatsAppReadinessSnapshot {
  function hasWhatsAppLoginBlockingText() {
    const text = document.body?.innerText ?? '';
    if (!text) return false;
    return [
      /escaneie\s+para\s+entrar/i,
      /escaneie\s+o\s+c[oó]digo\s+qr/i,
      /entrar\s+com\s+n[uú]mero\s+de\s+telefone/i,
      /use\s+o\s+whatsapp\s+no\s+seu\s+computador/i,
      /scan\s+(?:the\s+)?qr/i,
      /scan\s+to\s+(?:log\s+in|link)/i,
      /link\s+with\s+phone\s+number/i,
      /log\s+in\s+to\s+whatsapp/i,
      /use\s+whatsapp\s+(?:on|in)\s+your\s+computer/i,
    ].some((pattern) => pattern.test(text));
  }

  function hasWhatsAppSyncBlockingText() {
    const text = document.body?.innerText ?? '';
    if (!text) return false;
    return [
      /mantenha\s+o\s+app\s+aberto\s+nos\s+dois\s+dispositivos/i,
      /keep\s+(?:the\s+)?app\s+open\s+on\s+both\s+devices/i,
      /keep\s+whatsapp\s+open\s+on\s+both\s+devices/i,
      /sincronizando\s+(?:suas\s+)?mensagens/i,
      /syncing\s+(?:your\s+)?messages/i,
      /carregando\s+(?:suas\s+)?mensagens/i,
      /loading\s+(?:your\s+)?messages/i,
    ].some((pattern) => pattern.test(text));
  }

  if (!location.origin.startsWith('https://web.whatsapp.com')) {
    return {
      authenticated: false,
      hasBlockingLoginUi: false,
      hasChatUi: false,
      readyForHandoff: false,
      reason: 'not_whatsapp_web',
      syncing: false,
    };
  }

  const blockingSelectors = [
    'canvas[aria-label*="Scan"]',
    'canvas[aria-label*="Escane"]',
    '[data-testid="qrcode"]',
    '[data-ref] canvas',
    'input[name="phone"]',
  ];
  const hasBlockingLoginUi =
    hasWhatsAppLoginBlockingText() ||
    blockingSelectors.some((selector) => document.querySelector(selector));
  const hasSyncBlockingText = hasWhatsAppSyncBlockingText();
  const selectors = [
    '#side',
    '[data-testid="chat-list"]',
    '[data-testid="conversation-list"]',
    '[data-testid="conversation-panel-wrapper"]',
    '[aria-label="Chat list"]',
    '[aria-label="Lista de conversas"]',
    '[contenteditable="true"][role="textbox"]',
  ];
  const hasChatUi = selectors.some((selector) =>
    document.querySelector(selector)
  );
  const authenticated = !hasBlockingLoginUi && hasChatUi;
  const readyForHandoff = authenticated && !hasSyncBlockingText;
  const reason = hasBlockingLoginUi
    ? 'login_required'
    : hasSyncBlockingText
      ? 'whatsapp_web_syncing'
      : hasChatUi
        ? 'ready_for_handoff'
        : 'waiting_for_chat_ui';

  return {
    authenticated,
    hasBlockingLoginUi,
    hasChatUi,
    readyForHandoff,
    reason,
    syncing: authenticated && hasSyncBlockingText,
  };
}

export async function readWhatsAppPageContext(): Promise<WhatsAppPageContext> {
  const indexedDbNames =
    typeof indexedDB.databases === 'function'
      ? await indexedDB
          .databases()
          .then((databases) =>
            databases
              .map((database) => database.name)
              .filter((name): name is string => Boolean(name))
          )
          .catch(() => [])
      : [];
  const whatsappGlobal = globalThis as typeof globalThis & {
    Debug?: { VERSION?: unknown };
  };
  const debugVersion =
    typeof whatsappGlobal.Debug?.VERSION === 'string'
      ? whatsappGlobal.Debug.VERSION
      : undefined;
  const versionSource = [
    debugVersion,
    document.querySelector('meta[name="version"]')?.getAttribute('content'),
    document.documentElement.getAttribute('data-app-version'),
  ].find((value) => value?.trim());

  return {
    href: location.href,
    indexedDbNames,
    userAgent: navigator.userAgent,
    webVersion: versionSource?.trim(),
  };
}

export async function extractWhatsAppWebAuthDump(): Promise<WhatsAppWebAuthDump> {
  const extractionDebug: Array<Record<string, unknown>> = [];
  let serializationLossCount = 0;

  function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function pushDebug(event: string, details?: Record<string, unknown>) {
    extractionDebug.push({
      details: details || {},
      event,
    });
  }

  function summarizeRecordKeys(value: unknown) {
    return isRecord(value) ? Object.keys(value).slice(0, 40).sort() : [];
  }

  function summarizePair(pair: KeyPairBytes | null) {
    return pair
      ? {
          plausible: isPlausibleNoiseKeyPair(pair.private, pair.public),
          priv_len: pair.private.length,
          pub_len: pair.public.length,
        }
      : null;
  }

  function bytesToBase64(value: unknown) {
    const bytes = toUint8(value);
    if (!bytes) return null;
    let binary = '';
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) {
      binary += String.fromCharCode(...bytes.subarray(index, index + step));
    }
    return btoa(binary);
  }

  function bytesToBase64Required(value: unknown, label: string) {
    const base64 = bytesToBase64(value);
    if (!base64) {
      throw new Error(`Não foi possível converter ${label} para base64.`);
    }
    return base64;
  }

  function encodeBinaryValue(value: ArrayBuffer | ArrayBufferView) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

    return {
      __wwebjs_type: 'array_buffer',
      data: bytesToBase64Required(bytes, 'indexeddb bytes'),
    };
  }

  async function serializeJsonSafe(
    value: unknown,
    seen = new WeakSet<object>(),
    depth = 0
  ): Promise<unknown> {
    if (typeof value === 'bigint') {
      return {
        __wwebjs_type: 'bigint',
        value: value.toString(),
      };
    }

    if (value === undefined) {
      return { __wwebjs_type: 'undefined' };
    }

    if (typeof value === 'function' || typeof value === 'symbol') {
      serializationLossCount += 1;
      return { __wwebjs_type: 'unsupported' };
    }

    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (depth > 20 || seen.has(value)) {
      serializationLossCount += 1;
      return { __wwebjs_type: 'unsupported' };
    }
    seen.add(value);

    if (value instanceof ArrayBuffer) {
      return encodeBinaryValue(value);
    }

    if (ArrayBuffer.isView(value)) {
      return serializeJsonSafe(
        value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength
        ),
        seen,
        depth + 1
      );
    }

    if (value instanceof Blob) {
      const encoded = await serializeJsonSafe(await value.arrayBuffer());
      if (
        !isRecord(encoded) ||
        encoded.__wwebjs_type !== 'array_buffer' ||
        typeof encoded.data !== 'string'
      ) {
        serializationLossCount += 1;
        return { __wwebjs_type: 'unsupported' };
      }

      return {
        __wwebjs_type: 'blob',
        mime_type: value.type,
        data: encoded.data,
      };
    }

    if (value instanceof Date) {
      return {
        __wwebjs_type: 'date',
        value: value.toISOString(),
      };
    }

    if (value instanceof RegExp) {
      return {
        __wwebjs_type: 'regexp',
        flags: value.flags,
        source: value.source,
      };
    }

    if (value instanceof Map) {
      return {
        __wwebjs_type: 'map',
        entries: await Promise.all(
          [...value.entries()].map(async ([key, entry]) => [
            await serializeJsonSafe(key, seen, depth + 1),
            await serializeJsonSafe(entry, seen, depth + 1),
          ])
        ),
      };
    }

    if (value instanceof Set) {
      return {
        __wwebjs_type: 'set',
        values: await Promise.all(
          [...value].map((entry) => serializeJsonSafe(entry, seen, depth + 1))
        ),
      };
    }

    if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) {
      serializationLossCount += 1;
      return { __wwebjs_type: 'unsupported' };
    }

    if (Array.isArray(value)) {
      return Promise.all(
        value.map((item) => serializeJsonSafe(item, seen, depth + 1))
      );
    }

    const output: JsonRecord = {};
    for (const [key, item] of Object.entries(value as JsonRecord)) {
      output[key] = await serializeJsonSafe(item, seen, depth + 1);
    }

    return output;
  }

  function toUint8(value: unknown): Uint8Array | null {
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (typeof value === 'string') {
      const base64Bytes = base64ToBytes(value);
      if (base64Bytes) return base64Bytes;
      return Uint8Array.from(value, (char) => char.charCodeAt(0));
    }
    if (
      isRecord(value) &&
      value.type === 'Buffer' &&
      typeof value.data === 'string'
    ) {
      try {
        return Uint8Array.from(atob(value.data), (char) => char.charCodeAt(0));
      } catch {
        return null;
      }
    }
    return null;
  }

  function base64ToBytes(value: string) {
    const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    try {
      return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    } catch {
      return null;
    }
  }

  function getPath(value: unknown, path: string[]) {
    let current = value;
    for (const key of path) {
      if (!isRecord(current)) return undefined;
      current = current[key];
    }
    return current;
  }

  function toUint8FromPaths(value: unknown, paths: string[][]) {
    for (const path of paths) {
      const bytes = toUint8(getPath(value, path));
      if (bytes) return bytes;
    }
    return null;
  }

  function toPositiveInteger(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  }

  function normalizeOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function openIndexedDb(name: string) {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error || new Error(`indexeddb_open_failed:${name}`));
      };
    });
  }

  function getAllFromIndexedDbStore(database: IDBDatabase, storeName: string) {
    return new Promise<unknown[]>((resolve, reject) => {
      try {
        if (!database.objectStoreNames.contains(storeName)) {
          resolve([]);
          return;
        }
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => {
          resolve(Array.isArray(request.result) ? request.result : []);
        };
        request.onerror = () => {
          reject(
            request.error || new Error(`indexeddb_get_all_failed:${storeName}`)
          );
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async function getIndexedDbStoreRecords(
    database: IDBDatabase,
    storeName: string,
    transformValue?: (value: unknown) => unknown
  ) {
    const snapshot = await new Promise<{
      autoIncrement: boolean;
      keyPath: string | string[] | null;
      name: string;
      records: Array<{ key: unknown; value: unknown }>;
    }>((resolve, reject) => {
      try {
        if (!database.objectStoreNames.contains(storeName)) {
          resolve({
            autoIncrement: false,
            keyPath: null,
            name: storeName,
            records: [],
          });
          return;
        }

        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const records: Array<{ key: unknown; value: unknown }> = [];
        const request = store.openCursor();

        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;

          records.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        };
        request.onerror = () => {
          reject(
            request.error || new Error(`indexeddb_cursor_failed:${storeName}`)
          );
        };
        transaction.oncomplete = () => {
          resolve({
            autoIncrement: store.autoIncrement,
            keyPath: store.keyPath,
            name: storeName,
            records,
          });
        };
        transaction.onerror = () => {
          reject(
            transaction.error ||
              new Error(`indexeddb_transaction_failed:${storeName}`)
          );
        };
      } catch (error) {
        reject(error);
      }
    });

    return {
      ...snapshot,
      records: await Promise.all(
        snapshot.records.map(async (record) => ({
          key: (await serializeJsonSafe(record.key)) ?? null,
          value: await serializeJsonSafe(
            transformValue ? transformValue(record.value) : record.value
          ),
        }))
      ),
    };
  }

  async function getAllFromFirstStore(
    database: IDBDatabase,
    storeNames: string[]
  ) {
    for (const storeName of storeNames) {
      const rows = await getAllFromIndexedDbStore(database, storeName);
      if (rows.length > 0) return rows;
    }
    return [];
  }

  function createSignalMetaMap(rows: unknown[]) {
    const metaMap: JsonRecord = {};
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const key = normalizeOptionalString(row.key);
      if (!key) continue;
      metaMap[key] = row.value;
    }
    return metaMap;
  }

  async function decryptRegistrationMaterial(value: unknown) {
    if (!isRecord(value)) return null;
    const encrypted = toUint8(value.value);
    if (!value.encKey || !encrypted) return null;
    const decrypted = await crypto.subtle.decrypt(
      { counter: new Uint8Array(16), length: 128, name: 'AES-CTR' },
      value.encKey as CryptoKey,
      new Uint8Array(encrypted)
    );
    return new Uint8Array(decrypted);
  }

  function unwrapModule(moduleValue: unknown) {
    return isRecord(moduleValue) && moduleValue.default
      ? moduleValue.default
      : moduleValue;
  }

  function getWaModule(name: string) {
    const whatsappGlobal = globalThis as typeof globalThis & {
      __d?: ((...args: unknown[]) => void) & {
        require?: (moduleName: string) => unknown;
      };
      require?: (moduleName: string) => unknown;
    };

    try {
      if (typeof whatsappGlobal.require === 'function') {
        return unwrapModule(whatsappGlobal.require(name));
      }
    } catch {}

    try {
      if (typeof whatsappGlobal.__d === 'function') {
        let captured: unknown;
        const sentinel = `__underchatWaProbe_${Math.random()
          .toString(36)
          .slice(2)}`;
        whatsappGlobal.__d(
          sentinel,
          [name],
          (
            _target: unknown,
            _exports: unknown,
            _module: unknown,
            parentRequire: unknown
          ) => {
            if (typeof parentRequire === 'function') {
              captured = unwrapModule(
                (parentRequire as (moduleName: string) => unknown)(name)
              );
            }
          }
        );
        if (!captured && typeof whatsappGlobal.__d.require === 'function') {
          captured = unwrapModule(whatsappGlobal.__d.require(name));
        }
        if (captured) return captured;
      }
    } catch {}

    return null;
  }

  async function getRegistrationInfoViaInternalModule() {
    const moduleValue = getWaModule('WAWebSignalStoreApi');
    const signalStore = isRecord(moduleValue)
      ? moduleValue.waSignalStore
      : null;
    const getter = isRecord(signalStore)
      ? signalStore.getRegistrationInfo
      : null;
    if (typeof getter !== 'function') return null;
    try {
      return await (getter as () => Promise<unknown>)();
    } catch {
      return null;
    }
  }

  async function getNoiseInfoViaInternalModule() {
    const moduleValue = getWaModule('WAWebUserPrefsInfoStore');
    pushDebug('noise.module.lookup', {
      module_keys: summarizeRecordKeys(moduleValue),
      module_present: isRecord(moduleValue),
    });

    const containers: Array<{ label: string; value: JsonRecord }> = [];
    if (isRecord(moduleValue)) {
      containers.push({ label: 'module', value: moduleValue });
      if (isRecord(moduleValue.waNoiseInfo)) {
        containers.push({
          label: 'module.waNoiseInfo',
          value: moduleValue.waNoiseInfo,
        });
      }
      if (isRecord(moduleValue.default)) {
        containers.push({
          label: 'module.default',
          value: moduleValue.default,
        });
      }
      if (
        isRecord(moduleValue.default) &&
        isRecord(moduleValue.default.waNoiseInfo)
      ) {
        containers.push({
          label: 'module.default.waNoiseInfo',
          value: moduleValue.default.waNoiseInfo,
        });
      }
    }

    for (const candidate of containers) {
      const container = candidate.value;
      pushDebug('noise.container.inspect', {
        keys: summarizeRecordKeys(container),
        label: candidate.label,
      });
      const directPair = normalizeNoiseKeyPair(container);
      if (directPair) {
        pushDebug('noise.source.selected', {
          pair: summarizePair(directPair),
          source: candidate.label,
        });
        return directPair;
      }

      for (const field of ['noiseInfo', 'staticKeyPair', 'keyPair', 'value']) {
        const fieldPair = normalizeNoiseKeyPair(container[field]);
        if (fieldPair) {
          pushDebug('noise.source.selected', {
            pair: summarizePair(fieldPair),
            source: `${candidate.label}.${field}`,
          });
          return fieldPair;
        }
      }

      for (const methodName of [
        'getUnlockedNoiseInfo',
        'getNoiseInfo',
        'get',
        'getNoiseInfoStore',
      ]) {
        const getter = container[methodName];
        if (typeof getter !== 'function') {
          pushDebug('noise.method.missing', {
            container: candidate.label,
            method: methodName,
          });
          continue;
        }
        try {
          const value = await (getter as () => Promise<unknown>).call(
            container
          );
          const pair = normalizeNoiseKeyPair(value);
          pushDebug('noise.method.result', {
            container: candidate.label,
            method: methodName,
            pair: summarizePair(pair),
            value_keys: summarizeRecordKeys(value),
          });
          if (pair) return pair;
        } catch (error) {
          pushDebug('noise.method.error', {
            container: candidate.label,
            method: methodName,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return getNoiseInfoFromLocalStorage();
  }

  function normalizeNoiseKeyPair(value: unknown): KeyPairBytes | null {
    if (!isRecord(value)) return null;

    const candidates = [
      value,
      value.staticKeyPair,
      value.keyPair,
      value.noiseKey,
      value.noiseInfo,
      value.value,
      value.data,
    ];

    for (const candidate of candidates) {
      if (!isRecord(candidate)) continue;
      const publicKey = toUint8FromPaths(candidate, [
        ['pubKey'],
        ['publicKey'],
        ['public'],
        ['pub'],
      ]);
      const privateKey = toUint8FromPaths(candidate, [
        ['privKey'],
        ['privateKey'],
        ['private'],
        ['priv'],
      ]);
      if (publicKey && privateKey) {
        pushDebug('noise.pair.candidate', {
          pair: summarizePair({ private: privateKey, public: publicKey }),
        });
        if (!isPlausibleNoiseKeyPair(privateKey, publicKey)) {
          continue;
        }
        return { private: privateKey, public: publicKey };
      }
    }

    return null;
  }

  function isPlausibleNoiseKeyPair(
    privateKey: Uint8Array,
    publicKey: Uint8Array
  ) {
    return (
      privateKey.length === 32 &&
      (publicKey.length === 32 || publicKey.length === 33)
    );
  }

  function getNoiseInfoFromLocalStorage() {
    for (const key of ['WANoiseInfo', 'NOISE_INFO', 'MD_NOISE_KEYS']) {
      const value = readLocalStorageJson(key);
      pushDebug('noise.local_storage.inspect', {
        key,
        keys: summarizeRecordKeys(value),
        present: value !== null,
        type: Array.isArray(value) ? 'array' : typeof value,
      });
      const pair = normalizeNoiseKeyPair(value);
      if (pair) {
        pushDebug('noise.source.selected', {
          pair: summarizePair(pair),
          source: `localStorage.${key}`,
        });
        return pair;
      }
    }

    return null;
  }

  async function getAdvSecretKeyBase64() {
    const moduleValue = getWaModule('WAWebUserPrefsMultiDevice');
    const getter = isRecord(moduleValue) ? moduleValue.getADVSecretKey : null;
    if (typeof getter !== 'function') return null;
    try {
      const value = await (getter as () => Promise<unknown>)();
      if (typeof value === 'string') return value;
      return bytesToBase64(value);
    } catch {
      return null;
    }
  }

  async function getModelTableRows(
    moduleName: string,
    tableGetterName: string
  ) {
    const moduleValue = getWaModule(moduleName);
    const getter = isRecord(moduleValue) ? moduleValue[tableGetterName] : null;
    if (typeof getter !== 'function') return [];
    try {
      const table = (getter as () => unknown)();
      const all = isRecord(table) ? table.all : null;
      if (typeof all !== 'function') return [];
      const rows = await (all as () => Promise<unknown>)();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function getLatestSignedPreKey(rows: unknown[]) {
    const candidates: Array<{
      keyId: number;
      keyPair: { private: string; public: string };
      signature: string;
    }> = [];
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const keyPair = isRecord(row.keyPair) ? row.keyPair : null;
      const keyId = toPositiveInteger(row.keyId);
      const publicKey = keyPair
        ? toUint8FromPaths(keyPair, [['pubKey'], ['publicKey'], ['public']])
        : null;
      const privateKey = keyPair
        ? toUint8FromPaths(keyPair, [['privKey'], ['privateKey'], ['private']])
        : null;
      const signature = toUint8(row.signature);
      if (!keyId || !publicKey || !privateKey || !signature) continue;
      candidates.push({
        keyId,
        keyPair: {
          private: bytesToBase64Required(privateKey, 'signed pre-key private'),
          public: bytesToBase64Required(publicKey, 'signed pre-key public'),
        },
        signature: bytesToBase64Required(signature, 'signed pre-key signature'),
      });
    }
    candidates.sort((left, right) => left.keyId - right.keyId);
    return candidates[candidates.length - 1] || null;
  }

  function extractAdvAccount(value: unknown) {
    if (!isRecord(value)) return null;
    const accountSignature = bytesToBase64(value.accountSignature);
    const accountSignatureKey = bytesToBase64(value.accountSignatureKey);
    const details = bytesToBase64(value.details);
    const deviceSignature = bytesToBase64(value.deviceSignature);
    if (
      !accountSignature ||
      !accountSignatureKey ||
      !details ||
      !deviceSignature
    ) {
      return null;
    }
    return { accountSignature, accountSignatureKey, details, deviceSignature };
  }

  function readLocalStorageJson(key: string) {
    const value = localStorage.getItem(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  function dumpLocalStorage() {
    const output: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      const value = localStorage.getItem(key);
      if (value !== null) {
        output[key] = value;
      }
    }
    return output;
  }

  async function dumpSignalStorageProfile(input: {
    staticPrivateKey: Uint8Array;
    staticPublicKey: Uint8Array;
  }) {
    const database = await openIndexedDb('signal-storage');
    const storeNames = Array.from(database.objectStoreNames);
    try {
      const stores = await Promise.all(
        storeNames.map((storeName) =>
          getIndexedDbStoreRecords(database, storeName, (row) => {
            if (storeName !== 'signal-meta-store' || !isRecord(row)) {
              return row;
            }

            if (row.key === 'signal_static_pubkey') {
              return { ...row, value: input.staticPublicKey };
            }

            if (row.key === 'signal_static_privkey') {
              return { ...row, value: input.staticPrivateKey };
            }

            return row;
          })
        )
      );

      return {
        databaseName: 'signal-storage',
        stores,
      };
    } finally {
      database.close();
    }
  }

  function widValueToString(value: unknown) {
    if (typeof value === 'string') return value;
    if (!isRecord(value)) return null;
    return (
      normalizeOptionalString(value._serialized) ||
      normalizeOptionalString(value.serialized) ||
      normalizeOptionalString(value.id) ||
      normalizeOptionalString(value.user)
    );
  }

  function widToJid(value: unknown) {
    const wid = widValueToString(value);
    if (!wid) return null;
    const atIndex = wid.lastIndexOf('@');
    const head = atIndex >= 0 ? wid.slice(0, atIndex) : wid;
    const rawServer =
      atIndex >= 0 ? wid.slice(atIndex + 1).toLowerCase() : 's.whatsapp.net';
    const server = rawServer === 'c.us' ? 's.whatsapp.net' : rawServer;
    const colonIndex = head.indexOf(':');
    const userAndAgent = colonIndex >= 0 ? head.slice(0, colonIndex) : head;
    const device = colonIndex >= 0 ? Number(head.slice(colonIndex + 1)) : 0;
    const dotIndex = userAndAgent.indexOf('.');
    const user = dotIndex >= 0 ? userAndAgent.slice(0, dotIndex) : userAndAgent;
    if (!user || !Number.isFinite(device)) return null;
    return `${user}:${device}@${server}`;
  }

  function readMeFromModules() {
    const connModel = getWaModule('WAWebConnModel');
    const conn = isRecord(connModel) ? connModel.Conn : null;
    if (!isRecord(conn)) return { id: null, lid: null };
    return {
      id: widToJid(conn.wid || conn.me || conn.meUser),
      lid: widToJid(conn.lid || conn.meLid || conn.lidWid),
    };
  }

  if (!location.origin.startsWith('https://web.whatsapp.com')) {
    throw new Error('A janela atual não está no WhatsApp Web.');
  }

  const signalDb = await openIndexedDb('signal-storage');
  let metaRows: unknown[] = [];
  let signedPreKeyRows: unknown[] = [];
  try {
    metaRows = await getAllFromFirstStore(signalDb, ['signal-meta-store']);
    signedPreKeyRows = await getAllFromFirstStore(signalDb, [
      'signed-prekey-store',
      'signed-pre-key-store',
    ]);
  } finally {
    signalDb.close();
  }

  const metaMap = createSignalMetaMap(metaRows);
  const registrationInfo = await getRegistrationInfoViaInternalModule();
  const staticPublicKey =
    (await decryptRegistrationMaterial(metaMap.signal_static_pubkey)) ||
    toUint8FromPaths(registrationInfo, [
      ['identityKeyPair', 'pubKey'],
      ['identityKeyPair', 'publicKey'],
      ['identityKeyPair', 'public'],
    ]);
  const staticPrivateKey =
    (await decryptRegistrationMaterial(metaMap.signal_static_privkey)) ||
    toUint8FromPaths(registrationInfo, [
      ['identityKeyPair', 'privKey'],
      ['identityKeyPair', 'privateKey'],
      ['identityKeyPair', 'private'],
    ]);
  const noise = await getNoiseInfoViaInternalModule();
  const signedPreKey = getLatestSignedPreKey(signedPreKeyRows);
  const account = extractAdvAccount(metaMap.adv_signed_identity);
  const registrationId =
    toPositiveInteger(metaMap.signal_reg_id) ||
    toPositiveInteger(getPath(registrationInfo, ['registrationId'])) ||
    toPositiveInteger(getPath(registrationInfo, ['regId']));
  const moduleMe = readMeFromModules();
  const meId = widToJid(readLocalStorageJson('last-wid-md')) || moduleMe.id;
  const meLid = widToJid(readLocalStorageJson('WALid')) || moduleMe.lid;
  const meDisplayName = normalizeOptionalString(
    readLocalStorageJson('me-display-name')
  );

  if (!registrationId) {
    throw new Error('Não foi possível extrair o registrationId da sessão.');
  }
  if (!noise) {
    throw new Error('Não foi possível extrair a noise key da sessão.');
  }
  if (!staticPublicKey || !staticPrivateKey) {
    throw new Error('Não foi possível extrair a identity key da sessão.');
  }
  if (!signedPreKey) {
    throw new Error('Não foi possível extrair a signed pre-key da sessão.');
  }
  if (!account) {
    throw new Error('Não foi possível extrair a identidade ADV da sessão.');
  }
  if (!meId) {
    throw new Error('Não foi possível identificar o JID conectado.');
  }

  const syncKeyRows = await getModelTableRows(
    'WAWebSchemaSyncKeys',
    'getSyncKeysTable'
  );
  const versionRows = await getModelTableRows(
    'WAWebSchemaCollectionVersion',
    'getCollectionVersionTable'
  );
  const preKeyId =
    toPositiveInteger(metaMap.signal_prekey_id) ||
    toPositiveInteger(metaMap.signal_pre_key_id) ||
    signedPreKey.keyId + 1;
  const signalStorage = await dumpSignalStorageProfile({
    staticPrivateKey,
    staticPublicKey,
  });

  return {
    appStateSyncKeyCount: syncKeyRows.length,
    appStateVersionCount: versionRows.length,
    creds: {
      account,
      advSecretKey: await getAdvSecretKeyBase64(),
      firstUnuploadedPreKeyId: preKeyId,
      me: {
        id: meId,
        ...(meLid ? { lid: meLid } : {}),
        ...(meDisplayName ? { name: meDisplayName } : {}),
      },
      nextPreKeyId: preKeyId,
      noiseKey: {
        private: bytesToBase64Required(noise.private, 'noise private key'),
        public: bytesToBase64Required(noise.public, 'noise public key'),
      },
      platform: 'web',
      registrationId,
      signedIdentityKey: {
        private: bytesToBase64Required(
          staticPrivateKey,
          'identity private key'
        ),
        public: bytesToBase64Required(staticPublicKey, 'identity public key'),
      },
      signedPreKey,
    },
    profile: {
      complete: serializationLossCount === 0,
      localStorage: dumpLocalStorage(),
      lossyRecordCount: serializationLossCount,
      serializationFormat: 'wwebjs-browser-value-v1',
      signalStorage,
    },
  };
}
