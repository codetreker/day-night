import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/app.css';
import { LocaleProvider } from './i18n/LocaleProvider';
import { resolveInitialLocale } from './i18n/locale';
import { messagesByLocale } from './i18n/messages';
import { parseRoute } from './app/router';

const initial = resolveInitialLocale();
document.documentElement.lang = initial.locale;
document.title = messagesByLocale[initial.locale].workspace.app.documentTitle[parseRoute(window.location.pathname).kind];

const container = document.getElementById('root');
if (container === null) throw new Error('The application root element is missing.');
createRoot(container).render(<LocaleProvider initial={initial}><App /></LocaleProvider>);
