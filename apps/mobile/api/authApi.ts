import { BACKEND_URL } from '../config';
import { apiGet } from './client';
import type { AttendanceGuardStatus } from '../types/attendanceHours';

export interface AuthLoginRequest {
  login: string;
  password: string;
}

export interface AuthLoginResponse {
  user: Record<string, unknown>;
  token: string;
  permissions: string[];
  layout: Record<string, unknown> | null;
  sectors: string[];
  channels: Array<{ id: string; name: string }>;
  plan_is_active: boolean;
  plan_products: string[];
  attendance_guard: AttendanceGuardStatus;
}

interface ApiResponse<T> {
  status: boolean;
  message: string;
  data: T | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export async function login(
  loginValue: string,
  password: string
): Promise<
  | { success: true; data: AuthLoginResponse }
  | { success: false; message: string }
> {
  if (!BACKEND_URL) {
    return {
      success: false,
      message: 'Backend URL não configurada. Verifique o arquivo .env',
    };
  }

  const url = `${BACKEND_URL}/v1/auth/login`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': 'pt',
      'X-Client-Platform': 'mobile',
    },
    body: JSON.stringify({ login: loginValue, password } as AuthLoginRequest),
  });

  const body = (await res.json()) as ApiResponse<AuthLoginResponse>;

  if (!body?.status) {
    return {
      success: false,
      message: body?.message ?? 'Credenciais de login inválidas.',
    };
  }

  if (!body.data) {
    return {
      success: false,
      message: body?.message ?? 'Credenciais de login inválidas.',
    };
  }

  return { success: true, data: body.data };
}

export async function fetchAuthenticatedUser(): Promise<Record<
  string,
  unknown
> | null> {
  const endpoints = ['/user/me', '/auth/me'];

  for (const endpoint of endpoints) {
    const response = await apiGet<Record<string, unknown>>(endpoint);
    if (isRecord(response?.data)) {
      return response.data;
    }
  }

  return null;
}
