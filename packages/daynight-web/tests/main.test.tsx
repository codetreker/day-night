import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocaleProviderProps } from '../src/i18n/LocaleProvider';

const render = vi.fn((..._args: unknown[]) => undefined);
const rootMetadata: { readonly language: string; readonly title: string }[] = [];
const createRoot = vi.fn((..._args: unknown[]) => {
  rootMetadata.push({ language: document.documentElement.lang, title: document.title });
  return { render };
});
vi.mock('react-dom/client', () => ({ createRoot: (...args: unknown[]) => createRoot(...args) }));

describe('application bootstrap', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.lang = '';
    document.title = '';
    rootMetadata.length = 0;
    createRoot.mockClear();
    render.mockClear();
    vi.resetModules();
  });

  it.each([
    { locale: 'en', path: '/', title: 'Checking sign-in · Daynight' },
    { locale: 'zh-CN', path: '/projects/00000000-0000-4000-8000-000000000001', title: '正在确认登录 · Daynight' },
  ])('resolves $locale before creating one React root with the authenticated application', async ({ locale, path, title }) => {
    window.localStorage.setItem('daynight.web.locale', locale);
    window.history.replaceState(null, '', path);
    document.body.innerHTML = '<div id="root"></div>';
    await import('../src/main');
    expect(createRoot).toHaveBeenCalledExactlyOnceWith(document.getElementById('root'));
    expect(rootMetadata).toEqual([{ language: locale, title }]);
    expect(render).toHaveBeenCalledTimes(1);
    const element = render.mock.calls[0]?.[0] as ReactElement<LocaleProviderProps>;
    expect(element.type).toHaveProperty('name', 'LocaleProvider');
    expect(element.props.initial).toEqual({ locale, issue: null });
    expect((element.props.children as ReactElement).type).toHaveProperty('name', 'AuthenticatedApp');
  });

  it('fails clearly when the HTML root element is missing', async () => {
    await expect(import('../src/main')).rejects.toThrow('The application root element is missing.');
    expect(createRoot).not.toHaveBeenCalled();
  });
});
