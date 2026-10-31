import { Layers3, Orbit, Sparkles } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Mode } from '../types';

export function ModeTransition({ mode, phase, onCovered, onFinished }: {
  mode: Mode;
  phase: 'cover' | 'reveal';
  onCovered: () => void;
  onFinished: () => void;
}) {
  const Icon = mode === 'tarot' ? Layers3 : Orbit;
  return <div className={`mode-transition mode-transition--${mode} mode-transition--${phase}`} role="status" aria-live="polite" onAnimationEnd={event => {
    if (event.target !== event.currentTarget) return;
    if (phase === 'cover') onCovered();
    else onFinished();
  }}>
    <div className="mode-transition__nebula" aria-hidden="true" />
    <div className="mode-transition__rays" aria-hidden="true" />
    <div className="mode-transition__constellation" aria-hidden="true">
      <svg viewBox="0 0 800 600"><path d="M40 380 190 180 330 260 460 90 590 220 760 120M190 180 210 450 410 510 590 220 680 470M330 260 410 510" />{[[40,380],[190,180],[330,260],[460,90],[590,220],[760,120],[210,450],[410,510],[680,470]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3" />)}</svg>
    </div>
    <div className="mode-transition__portal" aria-hidden="true">
      <div className="mode-transition__ring mode-transition__ring--outer" />
      <div className="mode-transition__ring mode-transition__ring--inner" />
      <div className="mode-transition__orbit" />
      {Array.from({ length: 24 }, (_, index) => <i key={index} className="mode-transition__particle" style={{ '--angle': `${index * 15}deg`, '--distance': `${145 + index % 4 * 26}px`, '--delay': `${index % 6 * -90}ms` } as CSSProperties} />)}
      <div className="mode-transition__sigil"><Icon /><Sparkles /></div>
    </div>
    <div className="mode-transition__caption"><span>Mysterious Realm</span><strong>{mode === 'tarot' ? '步入塔罗秘境' : '漫游浩瀚星河'}</strong><small>{mode === 'tarot' ? 'TAROT · INNER WISDOM' : 'ASTROLOGY · COSMIC JOURNEY'}</small></div>
  </div>;
}
