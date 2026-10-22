import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getFormats } from "./formats";
import type { Formats } from "./formats";
import { getBrowserLocaleStorage, LOCALE_STORAGE_KEY } from "./locale";
import type { InitialLocale, Locale, LocaleIssue, LocaleStorage } from "./locale";
import { messagesByLocale } from "./messages";
import type { Messages } from "./messages";

type I18n = {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly format: Formats;
};
type LocaleCommands = {
  readonly selectLocale: (locale: Locale) => void;
  readonly retrySave: () => void;
};

const I18nContext = createContext<I18n | null>(null);
const LocaleIssueContext = createContext<{ readonly issue: LocaleIssue | null } | null>(null);
const LocaleCommandsContext = createContext<LocaleCommands | null>(null);

export type LocaleProviderProps = {
  readonly initial: InitialLocale;
  readonly getStorage?: () => LocaleStorage;
  readonly children: ReactNode;
};

export const LocaleProvider = ({ initial, getStorage = getBrowserLocaleStorage, children }: LocaleProviderProps) => {
  const [locale, setLocale] = useState(initial.locale);
  const [issue, setIssue] = useState(initial.issue);
  const currentLocale = useRef(locale);
  const save = useCallback((next: Locale) => {
    try {
      getStorage().setItem(LOCALE_STORAGE_KEY, next);
      setIssue(null);
    } catch (cause) {
      setIssue({ kind: "write", cause });
    }
  }, [getStorage]);
  const selectLocale = useCallback((next: Locale) => {
    currentLocale.current = next;
    setLocale(next);
    save(next);
  }, [save]);
  const retrySave = useCallback(() => save(currentLocale.current), [save]);
  const commands = useMemo(() => ({ selectLocale, retrySave }), [selectLocale, retrySave]);
  const presentation = useMemo(() => ({ locale, messages: messagesByLocale[locale], format: getFormats(locale) }), [locale]);
  const preference = useMemo(() => ({ issue }), [issue]);

  return <LocaleCommandsContext value={commands}>
    <LocaleIssueContext value={preference}>
      <I18nContext value={presentation}>{children}</I18nContext>
    </LocaleIssueContext>
  </LocaleCommandsContext>;
};

export const useI18n = (): I18n => {
  const value = useContext(I18nContext);
  if (value === null) throw new Error("useI18n requires a LocaleProvider.");
  return value;
};

export const useLocaleCommands = (): LocaleCommands => {
  const value = useContext(LocaleCommandsContext);
  if (value === null) throw new Error("useLocaleCommands requires a LocaleProvider.");
  return value;
};

export const useLocalePreference = () => {
  const value = useContext(LocaleIssueContext);
  const commands = useContext(LocaleCommandsContext);
  if (value === null || commands === null) throw new Error("useLocalePreference requires a LocaleProvider.");
  return { issue: value.issue, ...commands };
};
