import { MoonStar, Sparkles, Star, Sun } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { AstroSymbol } from './AstroSymbol';

const zodiac = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];

export function LoadingScreen({ message, busy = true, children }: { message: string; busy?: boolean; children?: ReactNode }) {
  return <main className={`app-loading${busy ? ' is-loading' : ''}`}>
    <div className="loading-sky" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ '--star-x': `${(index * 37 + 11) % 100}%`, '--star-y': `${(index * 53 + 7) % 100}%`, '--star-delay': `${index % 7 * -.6}s` } as CSSProperties} />)}</div>
    <div className="loading-sanctuary">
      <div className="loading-celestial" aria-hidden="true">
        <div className="loading-celestial__aura" />
        <svg className="loading-celestial__wheel" viewBox="0 0 320 320" fill="none">
          <circle cx="160" cy="160" r="148" />
          <circle cx="160" cy="160" r="140" />
          <circle cx="160" cy="160" r="112" />
          {Array.from({ length: 60 }, (_, index) => <path key={index} d={`M160 12v${index % 5 === 0 ? 9 : 4}`} transform={`rotate(${index * 6} 160 160)`} />)}
          {zodiac.map((sign, index) => { const angle = (index * 30 - 90) * Math.PI / 180; return <AstroSymbol key={sign} id={sign} x={152 + Math.cos(angle) * 126} y={152 + Math.sin(angle) * 126} size={16} />; })}
        </svg>
        <div className="loading-celestial__orbit"><i /></div>
        <div className="loading-celestial__card loading-celestial__card--sun"><span>XIX</span><Sun /><small>THE SUN</small></div>
        <div className="loading-celestial__card loading-celestial__card--star"><span>XVII</span><Star /><small>THE STAR</small></div>
        <div className="loading-celestial__seal"><MoonStar /></div>
        <Sparkles className="loading-celestial__spark" />
      </div>
      <div className="loading-identity"><span className="loading-identity__rule" /><h1>秘域</h1><span className="loading-identity__subtitle">Mysterious Realm</span><p>以牌为镜 · 以星为引</p></div>
      <div className="loading-status" role={busy ? 'status' : undefined} aria-live="polite" aria-atomic="true">
        <span className="loading-status__message">{message}</span>
        {busy && <span className="loading-status__dots" aria-hidden="true"><i /><i /><i /></span>}
      </div>
      {children && <div className="loading-feedback">{children}</div>}
    </div>
    <span className="loading-signature" aria-hidden="true">THE UNIVERSE WITHIN</span>
  </main>;
}
