// i18n layer. Country names are keyed by numeric ISO code and loaded from
// per-locale files (extensible: drop a new JSON in ./locales and register it
// below). UI strings live in ./ui.ts. Designed so the rest of the app only ever
// asks for a name/string by language code.
import en from './locales/en.json';
import ru from './locales/ru.json';
import { ui, type UiKey } from './ui';

export type Language = 'en' | 'ru';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
];

const countryLocales: Record<Language, Record<string, string>> = { en, ru };

/**
 * Localised country name for a numeric ISO id. Falls back to English, then to
 * the provided raw fallback (e.g. the name embedded in the TopoJSON), then "?".
 */
export function countryName(
  id: string | null | undefined,
  lang: Language,
  fallback?: string,
): string {
  if (!id) return fallback ?? '?';
  return countryLocales[lang][id] ?? countryLocales.en[id] ?? fallback ?? '?';
}

/** Localised UI string. */
export function t(key: UiKey, lang: Language): string {
  return ui[lang][key] ?? ui.en[key] ?? key;
}
