import { createRoot } from 'react-dom/client';
import { AuthenticatedApp } from './app/AuthenticatedApp';
import './styles/app.css';
import { LocaleProvider } from './i18n/LocaleProvider';
import { resolveInitialLocale } from './i18n/locale';
import { messagesByLocale } from './i18n/messages';

const initial = resolveInitialLocale();
document.documentElement.lang = initial.locale;
document.title = messagesByLocale[initial.locale].auth.shell.documentTitle.loading;

const container = document.getElementById('root');
if (container === null) throw new Error('The application root element is missing.');
createRoot(container).render(<LocaleProvider initial={initial}><AuthenticatedApp /></LocaleProvider>);
