import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles/index.css';

createRoot(document.getElementById('app')!).render(<App />);
