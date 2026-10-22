import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthenticatedApp } from '../../src/app/AuthenticatedApp';
import { LocaleProvider } from '../../src/i18n/LocaleProvider';
import { resolveInitialLocale } from '../../src/i18n/locale';
import { authScenarios, installAuthFixture, readAuthScenario, type AuthScenario } from './auth-fixture';
import '../../src/styles/app.css';

const initial = readAuthScenario();
const initialLocale = resolveInitialLocale();
document.documentElement.lang = initialLocale.locale;
export const authFixture = installAuthFixture(initial);
const fixture = authFixture;
const AuthMockup = () => {
  const [scenario, setScenario] = useState<AuthScenario>(initial);
  const [revision, setRevision] = useState(0);
  const reset = (next: AuthScenario) => { fixture.reset(next); setScenario(next); setRevision((value) => value + 1); };
  return <>
    <AuthenticatedApp key={revision} navigateToLogin={(url) => { fixture.completeLogin(url); setRevision((value) => value + 1); }} />
    <aside aria-label="Authentication fixture controls" ref={(node) => { if (node !== null) Object.defineProperty(node, 'authFixture', { configurable: true, value: fixture }); }} style={{ position: 'fixed', zIndex: 200, bottom: 12, left: 12, maxWidth: 'calc(100vw - 24px)', border: '1px solid #e2e4ed', borderRadius: 8, background: '#fffffff5', boxShadow: '0 4px 22px #25325312', fontSize: 11 }}>
      <details><summary style={{ padding: '8px 12px', cursor: 'pointer', color: '#746c5d' }}>Component fixture · 场景</summary><div style={{ padding: '4px 12px 12px', width: 340, maxWidth: 'calc(100vw - 26px)', display: 'grid', gap: 10 }}>
        <label htmlFor="auth-fixture-scenario">受控 API 场景</label><select id="auth-fixture-scenario" value={scenario} onChange={(event) => reset(event.currentTarget.value as AuthScenario)}>{authScenarios.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
        <button className="button" type="button" onClick={() => reset(scenario)}>重置当前场景</button>
        <p>真实组件与受控同源 API；更改只保存在页面内。登录按钮模拟身份交接，不能证明 UniAuth 接入。</p>
        {(scenario.startsWith('tokens') || scenario.startsWith('token-') || scenario === 'clipboard-failure') && <p>选择「访问令牌」后创建令牌，检查一次性显示、复制或复制失败后的手工恢复。</p>}
        {scenario === 'attachments' && <p>原生 iframe 资源由浏览器验证按正常 API 路径提供；此 fixture 不替换产品附件 URL。</p>}
        <a className="button" href={`/tests/mockups/auth.html?scenario=${scenario}`}>重新载入 fixture 文档</a>
      </div></details>
    </aside>
  </>;
};

const container = document.getElementById('root');
if (container === null) throw new Error('The authentication fixture root is required.');
const root = createRoot(container);
root.render(<LocaleProvider initial={initialLocale}><AuthMockup /></LocaleProvider>);
import.meta.hot?.dispose(() => { root.unmount(); fixture.dispose(); });
