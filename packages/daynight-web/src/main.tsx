import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/app.css';

const container = document.getElementById('root');
if (container === null) throw new Error('The application root element is missing.');
createRoot(container).render(<App />);
