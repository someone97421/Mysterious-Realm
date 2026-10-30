import { Brain, ChevronDown } from 'lucide-react';
import './Reasoning.css';

export function Reasoning({ text, active = false }: { text?: string; active?: boolean }) {
  if (!text && !active) return null;
  return (
    <details className="reasoning-observer">
      <summary><Brain aria-hidden="true" /><span>思考观测</span><small>{active ? '进行中' : '思考记录'}</small><ChevronDown aria-hidden="true" /></summary>
      <div className="reasoning-observer__content" tabIndex={0}>
        {text || '正在等待模型返回思考内容…'}
      </div>
    </details>
  );
}
