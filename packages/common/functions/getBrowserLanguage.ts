export function getBrowserLanguage(): 'es' | 'en' | 'pt' {
  const lang = (
    navigator.language ||
    navigator.languages[0] ||
    'pt'
  ).toLowerCase();

  if (lang.startsWith('es')) {
    return 'es';
  }

  if (lang.startsWith('en')) {
    return 'en';
  }

  return 'pt';
}
