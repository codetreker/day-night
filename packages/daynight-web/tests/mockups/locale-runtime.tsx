import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageSelector } from '../../src/i18n/LanguageSelector';
import { LocaleProvider, useI18n } from '../../src/i18n/LocaleProvider';
import { resolveInitialLocale } from '../../src/i18n/locale';
import '../../src/styles/app.css';

const LocaleRuntimePreview = () => {
  const { locale, format } = useI18n();
  const [count, setCount] = useState(0);
  useLayoutEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <>
    <section className="fixture-controls" aria-label="Preview controls">
      <strong>Locale runtime preview</strong>
      <p>This preview uses the locale runtime without loading project or task data.</p>
      <button className="button" type="button" onClick={() => { setCount((value) => value + 1); }}>Fixture interaction</button>
      <output data-testid="fixture-count">{count}</output>
    </section>
    <header className="topbar">
      <span className="crumb">daynight</span>
      <LanguageSelector />
    </header>
    <main className="content">
      <h1>Language / 语言</h1>
      <section className="fixture-panel">
        <h2>Dialog header / 详情标题栏</h2>
        <LanguageSelector />
      </section>
      <section className="fixture-panel">
        <h2>Fullscreen toolbar / 全屏工具栏</h2>
        <LanguageSelector />
      </section>
      <dl className="fixture-values">
        <div><dt>Locale</dt><dd><output data-testid="active-locale">{locale}</output></dd></div>
        <div><dt>Number</dt><dd><output data-testid="formatted-number">{format.number(12345)}</output></dd></div>
        <div><dt>Bytes</dt><dd><output data-testid="formatted-bytes">{format.bytes(12345)}</output></dd></div>
      </dl>
    </main>
    <style>{`
      .fixture-controls{padding:14px 24px;background:#edf2f8;border-bottom:1px dashed #b9c5d5;color:#52637a;font-size:12px}
      .fixture-controls p{margin:5px 0 10px}.fixture-controls output{margin-left:12px}
      .fixture-panel{display:flex;align-items:center;justify-content:space-between;gap:16px;background:white;border:1px solid var(--line);border-radius:9px;padding:20px;margin-top:20px}
      .fixture-panel h2{font-size:14px;font-weight:500;color:var(--muted)}
      .fixture-values{display:grid;gap:12px;color:var(--muted);font-size:12px}.fixture-values div{display:flex;gap:20px}.fixture-values dd{margin:0}
      @media(max-width:600px){.topbar{height:auto;min-height:76px;gap:12px;flex-wrap:wrap;padding:15px 18px}.fixture-panel{align-items:flex-start;flex-direction:column}.fixture-controls{padding:14px 18px}}
    `}</style>
  </>;
};

const container = document.getElementById('root');
if (container === null) throw new Error('The locale preview root is missing.');
createRoot(container).render(<LocaleProvider initial={resolveInitialLocale()}><LocaleRuntimePreview /></LocaleProvider>);
