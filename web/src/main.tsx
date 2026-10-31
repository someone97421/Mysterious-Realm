import { createRoot } from 'react-dom/client';
import App from './App';
import { TooltipLayer } from './components/Tooltip';
import './styles.css';

createRoot(document.getElementById('root')!).render(<><TooltipLayer /><App /></>);
