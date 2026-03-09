export const SESSION_PLATFORMS = ['web', 'mobile'] as const;

export type SessionPlatform = (typeof SESSION_PLATFORMS)[number];
