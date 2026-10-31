import { createRoot } from 'react-dom/client';
import App from './App';
import { TooltipLayer } from './components/Tooltip';
import './styles.css';
import './astrology.css';
import './mode-theme.css';
import './workspace-layout.css';
import './auth.css';
import './loading.css';

createRoot(document.getElementById('root')!).render(<><TooltipLayer /><App /></>);
