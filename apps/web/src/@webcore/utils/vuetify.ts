import type { LiteralUnion } from 'type-fest';
import { cookieRef } from '@layouts/stores/config';

export const resolveVuetifyTheme = (
  defaultTheme: LiteralUnion<'light' | 'dark' | 'system', string>
): 'light' | 'dark' => {
  const cookieColorScheme = cookieRef<'light' | 'dark'>(
    'color-scheme',
    usePreferredDark().value ? 'dark' : 'light'
  );
  const storedTheme = cookieRef('theme', defaultTheme).value;

  if (storedTheme === 'system') {
    const isDark = cookieColorScheme.value === 'dark';

    return isDark ? 'dark' : 'light';
  }

  return storedTheme as 'light' | 'dark';
};
