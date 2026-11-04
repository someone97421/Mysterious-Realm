import { ArrowRight, LogOut, Moon, Orbit, Settings2, Sparkles, Star, Sun } from 'lucide-react';
import { useState, type CSSProperties, type PointerEvent } from 'react';
import type { Mode, User } from '../types';
import { cx } from '../utils';
import { Brand, Button } from './ui';

const zodiac = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
const stars = Array.from({ length: 42 }, (_, index) => ({
  left: `${(index * 47 + 11) % 100}%`,
  top: `${(index * 31 + 7) % 100}%`,
  delay: `${-(index % 9) * 0.7}s`,
  size: `${index % 7 === 0 ? 3 : 1}px`,
}));

function TarotArt() {
  return <div className="realm-choice__visual realm-tarot" aria-hidden="true">
    <div className="realm-tarot__aura" />
    <div className="realm-tarot__orbit"><i /><i /><i /></div>
    <div className="realm-tarot__fan">
      <div className="realm-tarot__card realm-tarot__card--left"><span>XVII</span><Star /><small>希望</small></div>
      <div className="realm-tarot__card realm-tarot__card--right"><span>XVIII</span><Moon /><small>直觉</small></div>
      <div className="realm-tarot__card realm-tarot__card--main">
        <span>XIX</span><div className="realm-tarot__sun"><Sun /><i /></div><Sparkles className="realm-tarot__spark" /><small>THE SUN</small>
      </div>
    </div>
  </div>;
}

function AstrologyArt() {
  return <div className="realm-choice__visual realm-astrology" aria-hidden="true">
    <div className="realm-astrology__aura" />
    <div className="realm-astrology__wheel">
      <svg viewBox="0 0 300 300">
        <circle className="realm-astrology__ring" cx="150" cy="150" r="130" />
        <circle className="realm-astrology__ring realm-astrology__ring--inner" cx="150" cy="150" r="105" />
        {Array.from({ length: 60 }, (_, index) => <line key={index} className={index % 5 === 0 ? 'is-major' : ''} x1="150" y1="20" x2="150" y2={index % 5 === 0 ? '30' : '26'} transform={`rotate(${index * 6} 150 150)`} />)}
        {zodiac.map((symbol, index) => {
          const angle = (index * 30 - 90) * Math.PI / 180;
          return <text key={symbol} x={150 + Math.cos(angle) * 117} y={154 + Math.sin(angle) * 117}>{symbol}</text>;
        })}
        <path d="M150 45 229 195 71 195ZM150 255 71 105 229 105Z" />
        <circle className="realm-astrology__core" cx="150" cy="150" r="42" />
      </svg>
      <div className="realm-astrology__sigil"><Orbit /><Sparkles /></div>
      <i className="realm-astrology__planet realm-astrology__planet--one" />
      <i className="realm-astrology__planet realm-astrology__planet--two" />
    </div>
  </div>;
}

const choices: Array<{ mode: Mode; eyebrow: string; title: string; description: string; tags: string; action: string }> = [
  { mode: 'tarot', eyebrow: 'TAROT · 聆听内心', title: '让牌面，照见心底的答案', description: '把未曾言说的疑惑，交给一场温柔而真诚的对话。', tags: '情感 · 选择 · 自我探索', action: '开启塔罗之旅' },
  { mode: 'astrology', eyebrow: 'ASTROLOGY · 循星而行', title: '让星辰，讲述你的独特轨迹', description: '从出生星图到行星周期，看见属于你的节奏与可能。', tags: '本命 · 关系 · 行运', action: '启程探索星图' },
];

export function RealmGateway({ user, busy, onSelect, onAdmin, onLogout }: {
  user: User;
  busy: boolean;
  onSelect: (mode: Mode) => void;
  onAdmin: () => void;
  onLogout: () => void;
}) {
  const [selected, setSelected] = useState<Mode | null>(null);
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    event.currentTarget.style.setProperty('--pointer-x', `${x * 100}%`);
    event.currentTarget.style.setProperty('--pointer-y', `${y * 100}%`);
    event.currentTarget.style.setProperty('--rotate-x', `${(0.5 - y) * 4}deg`);
    event.currentTarget.style.setProperty('--rotate-y', `${(x - 0.5) * 5}deg`);
  };
  const reset = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.style.setProperty('--rotate-x', '0deg');
    event.currentTarget.style.setProperty('--rotate-y', '0deg');
  };
  const choose = (mode: Mode) => {
    if (selected || busy) return;
    setSelected(mode);
    onSelect(mode);
  };
  return <main className={cx('realm-gateway', selected && `realm-gateway--${selected}`)}>
    <div className="realm-gateway__stars" aria-hidden="true">{stars.map((star, index) => <i key={index} style={{ left: star.left, top: star.top, width: star.size, height: star.size, animationDelay: star.delay }} />)}</div>
    <div className="realm-gateway__nebula realm-gateway__nebula--tarot" aria-hidden="true" />
    <div className="realm-gateway__nebula realm-gateway__nebula--astrology" aria-hidden="true" />
    <span className="realm-gateway__watermark realm-gateway__watermark--tarot" aria-hidden="true">TAROT</span>
    <span className="realm-gateway__watermark realm-gateway__watermark--astrology" aria-hidden="true">ASTROLOGY</span>

    <header className="realm-gateway__header">
      <Brand />
      <div className="realm-gateway__account">
        <span className="realm-gateway__user">{user.display_name || user.username}</span>
        {user.role === 'admin' && <Button variant="ghost" onClick={onAdmin} disabled={busy}><Settings2 />管理</Button>}
        <Button variant="ghost" onClick={onLogout} disabled={busy}><LogOut />退出</Button>
      </div>
    </header>

    <div className="realm-gateway__content">
      <section className="realm-gateway__intro" aria-labelledby="realm-gateway-title">
        <span className="realm-gateway__eyebrow"><i />WELCOME TO MYSTERIOUS REALM<i /></span>
        <h1 id="realm-gateway-title">此刻，你想靠近哪一种智慧？</h1>
        <p>没有标准答案。跟随直觉，选择此刻最吸引你的那束光。</p>
      </section>

      <section className="realm-gateway__choices" aria-label="选择探索模式">
        {choices.map((choice, index) => <button
          type="button"
          key={choice.mode}
          className={cx('realm-choice', `realm-choice--${choice.mode}`, selected === choice.mode && 'is-selected', selected && selected !== choice.mode && 'is-receding')}
          style={{ '--enter-delay': `${280 + index * 130}ms` } as CSSProperties}
          aria-label={`${choice.action}：${choice.title}`}
          aria-pressed={selected === choice.mode}
          disabled={busy || selected !== null}
          onClick={() => choose(choice.mode)}
          onPointerMove={move}
          onPointerLeave={reset}
        >
          <span className="realm-choice__shine" aria-hidden="true" />
          <span className="realm-choice__number" aria-hidden="true">0{index + 1}</span>
          {choice.mode === 'tarot' ? <TarotArt /> : <AstrologyArt />}
          <span className="realm-choice__body">
            <span className="realm-choice__eyebrow">{choice.eyebrow}</span>
            <strong>{choice.title}</strong>
            <span className="realm-choice__description">{choice.description}</span>
            <span className="realm-choice__footer"><small>{choice.tags}</small><span>{choice.action}<ArrowRight /></span></span>
          </span>
        </button>)}
      </section>

      <footer className="realm-gateway__footer"><Sparkles /><span>牌是镜子，星是地图，而你始终是故事的主角。</span><Sparkles /></footer>
    </div>
  </main>;
}
