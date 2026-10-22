export type Locale = "en" | "zh-CN";

export type LocaleIssue = {
  readonly kind: "read" | "invalid" | "write";
  readonly cause: unknown;
};

export type InitialLocale = {
  readonly locale: Locale;
  readonly issue: LocaleIssue | null;
};

export type LocaleStorage = Pick<Storage, "getItem" | "setItem">;
export type BrowserLanguages = {
  readonly languages?: readonly string[];
  readonly language: string;
};
export type LocaleEnvironment = BrowserLanguages & {
  readonly getStorage: () => LocaleStorage;
};

export const LOCALE_STORAGE_KEY = "daynight.web.locale";

export const parseLocale = (value: unknown): Locale => {
  if (value === "en" || value === "zh-CN") return value;
  throw new Error("Invalid saved language preference.");
};

export const resolveBrowserLocale = ({ languages, language }: BrowserLanguages): Locale => {
  const preferred = languages === undefined || languages.length === 0 ? [language] : languages;
  for (const value of preferred) {
    if (/^en(?:-|$)/i.test(value)) return "en";
    if (/^zh(?:-|$)/i.test(value)) return "zh-CN";
  }
  return "en";
};

export const getBrowserLocaleStorage = (): LocaleStorage => window.localStorage;

export const resolveInitialLocale = (environment: LocaleEnvironment = {
  getStorage: getBrowserLocaleStorage,
  languages: navigator.languages,
  language: navigator.language,
}): InitialLocale => {
  let saved: string | null;
  try {
    saved = environment.getStorage().getItem(LOCALE_STORAGE_KEY);
  } catch (cause) {
    return { locale: resolveBrowserLocale(environment), issue: { kind: "read", cause } };
  }
  if (saved === null) return { locale: resolveBrowserLocale(environment), issue: null };
  try {
    return { locale: parseLocale(saved), issue: null };
  } catch (cause) {
    return { locale: resolveBrowserLocale(environment), issue: { kind: "invalid", cause } };
  }
};
