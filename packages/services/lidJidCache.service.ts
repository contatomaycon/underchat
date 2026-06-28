import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import { safeRedisGet } from '@core/plugins/redis';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { IChat } from '@core/common/interfaces/IChat';
import {
  IUpsertMessage,
  IUpsertMessageKey,
} from '@core/common/interfaces/IUpsertMessage';

interface MemoryEntry {
  phoneJid: string;
  expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_MEMORY_TTL_MS = 60 * 60 * 1000;
const MAX_MEMORY_ENTRIES = 100_000;

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return Math.floor(parsed);
}

@singleton()
export class LidJidCacheService {
  private readonly ttlSeconds = readPositiveIntEnv(
    'LID_JID_CACHE_TTL_SECONDS',
    DEFAULT_TTL_SECONDS
  );
  private readonly memoryTtlMs = readPositiveIntEnv(
    'LID_JID_CACHE_MEMORY_TTL_MS',
    DEFAULT_MEMORY_TTL_MS
  );
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(@inject('Redis') private readonly redis: Redis) {}

  isLidJid(jid?: string | null): boolean {
    return this.normalizeCandidate(jid)?.endsWith('@lid') === true;
  }

  async resolvePhoneJid(
    accountId: string,
    workerId: string,
    lidJid: string | null | undefined
  ): Promise<string | null> {
    const normalizedLid = this.normalizeCandidate(lidJid);
    if (!normalizedLid || !this.isLidJid(normalizedLid)) {
      return null;
    }

    const memoryKey = this.memoryKey(accountId, workerId, normalizedLid);
    const now = Date.now();
    const memoryValue = this.memory.get(memoryKey);
    if (memoryValue) {
      if (memoryValue.expiresAt > now) {
        return memoryValue.phoneJid;
      }
      this.memory.delete(memoryKey);
    }

    const cached = await safeRedisGet(
      this.redis,
      this.redisKey(accountId, workerId, normalizedLid)
    );
    const phoneJid = this.normalizePhoneJid(cached);
    if (!phoneJid) {
      return null;
    }

    this.setMemory(memoryKey, phoneJid);
    return phoneJid;
  }

  async remember(
    accountId: string,
    workerId: string,
    firstJid?: string | null,
    secondJid?: string | null
  ): Promise<string | null> {
    const pair = this.resolveLidPhonePair(firstJid, secondJid);
    if (!pair) {
      return null;
    }

    const key = this.redisKey(accountId, workerId, pair.lidJid);
    await this.redis.set(key, pair.phoneJid, 'EX', this.ttlSeconds);
    this.setMemory(
      this.memoryKey(accountId, workerId, pair.lidJid),
      pair.phoneJid
    );

    return pair.phoneJid;
  }

  async rememberFromUpsert(data: IUpsertMessage): Promise<string | null> {
    const key = data.message?.key;
    const remembered = await this.rememberFromMessageKey(
      data.account_id,
      data.worker_id,
      key
    );
    if (remembered) {
      return remembered;
    }

    return this.remember(
      data.account_id,
      data.worker_id,
      data.call_jid,
      data.call_jid_alt
    );
  }

  async rememberFromChat(
    accountId: string,
    workerId: string,
    chat: IChat | null | undefined
  ): Promise<string | null> {
    if (!chat) {
      return null;
    }

    const key = chat.message_key;
    const remembered = await this.remember(
      accountId,
      workerId,
      key?.remote_jid,
      key?.remote_jid_alt
    );
    if (remembered) {
      return remembered;
    }

    const lidJid = [key?.remote_jid, key?.remote_jid_alt]
      .map((candidate) => this.normalizeCandidate(candidate))
      .find((candidate): candidate is string => this.isLidJid(candidate));
    const phoneJid = this.phoneJidFromChatPhone(chat.phone);

    if (!lidJid || !phoneJid) {
      return null;
    }

    return this.remember(accountId, workerId, lidJid, phoneJid);
  }

  extractPhoneJidFromChat(chat: IChat | null | undefined): string | null {
    if (!chat) {
      return null;
    }

    const messageKey = chat.message_key;
    const fromKey = [messageKey?.remote_jid, messageKey?.remote_jid_alt]
      .map((candidate) => this.normalizePhoneJid(candidate))
      .find((candidate): candidate is string => Boolean(candidate));

    return fromKey ?? this.phoneJidFromChatPhone(chat.phone);
  }

  private async rememberFromMessageKey(
    accountId: string,
    workerId: string,
    key: IUpsertMessageKey | null | undefined
  ): Promise<string | null> {
    return this.remember(
      accountId,
      workerId,
      key?.remoteJid,
      key?.remoteJidAlt
    );
  }

  private resolveLidPhonePair(
    firstJid?: string | null,
    secondJid?: string | null
  ): { lidJid: string; phoneJid: string } | null {
    const first = this.normalizeCandidate(firstJid);
    const second = this.normalizeCandidate(secondJid);

    const candidates: Array<[string | undefined, string | undefined]> = [
      [first, second],
      [second, first],
    ];

    for (const [lidCandidate, phoneCandidate] of candidates) {
      if (!this.isLidJid(lidCandidate)) {
        continue;
      }

      const phoneJid = this.normalizePhoneJid(phoneCandidate);
      if (phoneJid) {
        return { lidJid: lidCandidate as string, phoneJid };
      }
    }

    return null;
  }

  private normalizeCandidate(value?: string | null): string | undefined {
    const raw = value?.trim();
    if (!raw) {
      return undefined;
    }

    return normalizeJid(raw) ?? raw;
  }

  private normalizePhoneJid(value?: string | null): string | null {
    const normalized = this.normalizeCandidate(value);
    if (!normalized || this.isLidJid(normalized)) {
      return null;
    }

    if (!normalized.endsWith('@s.whatsapp.net')) {
      return null;
    }

    const phone = getPhoneFromJid(normalized, null);
    if (!phone || phone.length < 8) {
      return null;
    }

    return normalized;
  }

  private phoneJidFromChatPhone(phone: unknown): string | null {
    if (typeof phone !== 'string') {
      return null;
    }

    const digits = phone.replaceAll(/\D/g, '');
    if (digits.length < 8) {
      return null;
    }

    return `${digits}@s.whatsapp.net`;
  }

  private redisKey(
    accountId: string,
    workerId: string,
    lidJid: string
  ): string {
    return `inbound:lid-jid:${accountId}:${workerId}:${lidJid}`;
  }

  private memoryKey(
    accountId: string,
    workerId: string,
    lidJid: string
  ): string {
    return `${accountId}:${workerId}:${lidJid}`;
  }

  private setMemory(key: string, phoneJid: string): void {
    if (this.memory.size >= MAX_MEMORY_ENTRIES) {
      const oldestKey = this.memory.keys().next().value as string | undefined;
      if (oldestKey) {
        this.memory.delete(oldestKey);
      }
    }

    this.memory.set(key, {
      phoneJid,
      expiresAt: Date.now() + this.memoryTtlMs,
    });
  }
}
