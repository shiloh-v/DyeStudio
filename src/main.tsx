import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { IS_PREVIEW } from './lib/preview';

// Apply the theme before first paint (avoids a flash). A saved preference always
// wins; otherwise preview builds default to dark, production to light.
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark' || (!savedTheme && IS_PREVIEW)) {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
