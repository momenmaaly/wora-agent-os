import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource-variable/inter';
import App from './App.js';
import './index.css';
import './styles/shell.css';
import './styles/dashboard.css';
import './styles/features.css';
import './styles/campus.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');
createRoot(root).render(<App />);
