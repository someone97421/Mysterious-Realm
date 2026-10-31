import { ArrowRight, Eye, EyeOff, KeyRound, Layers3, Moon, Orbit, Sparkles, Star, Sun, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, jsonBody } from '../api';
import type { User } from '../types';
import { errorMessage } from '../utils';
import { AstroSymbol } from './AstroSymbol';
import { Brand, Button, Field, IconButton, InlineNotice } from './ui';

const zodiac = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];

function CelestialGateway() {
  return <div className="gateway-art" aria-hidden="true">
    <div className="gateway-art__aura" />
    <svg className="gateway-art__sky" viewBox="0 0 600 460" fill="none">
      <defs><linearGradient id="gateway-orbit" x1="60" y1="40" x2="540" y2="420" gradientUnits="userSpaceOnUse"><stop stopColor="#c3a1f5" /><stop offset=".5" stopColor="#769fd1" /><stop offset="1" stopColor="#e6c590" /></linearGradient></defs>
      <g className="gateway-art__wheel" stroke="url(#gateway-orbit)">
        <circle cx="300" cy="230" r="202" strokeOpacity=".35" />
        <circle cx="300" cy="230" r="192" strokeOpacity=".15" />
        <circle cx="300" cy="230" r="155" strokeOpacity=".3" />
        {Array.from({ length: 72 }, (_, index) => <path key={index} d={`M300 28v${index % 6 === 0 ? 12 : 5}`} transform={`rotate(${index * 5} 300 230)`} strokeOpacity={index % 6 === 0 ? '.65' : '.25'} />)}
        {zodiac.map((sign, index) => { const angle = (index * 30 - 75) * Math.PI / 180; return <AstroSymbol key={sign} id={sign} x={290 + Math.cos(angle) * 174} y={220 + Math.sin(angle) * 174} size={20} />; })}
      </g>
      <ellipse cx="300" cy="230" rx="263" ry="101" transform="rotate(-24 300 230)" stroke="url(#gateway-orbit)" strokeOpacity=".3" />
      <path className="gateway-art__constellation" d="m52 141 63-65 67 44 89-74M439 338l68 39 53-87M47 321l76 43 44-32" stroke="#9fbfff" strokeOpacity=".35" />
      {[[52,141],[115,76],[182,120],[271,46],[439,338],[507,377],[560,290],[47,321],[123,364],[167,332]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.5" fill="#d6d7fa" />)}
      <circle cx="64" cy="190" r="5" fill="#a3c8f5" className="gateway-art__satellite" />
      <path d="M520 117v18m-9-9h18M85 390v12m-6-6h12" stroke="#e6c590" strokeWidth="1.2" />
    </svg>
    <div className="gateway-card gateway-card--moon"><span>XVIII</span><Moon /><small>THE MOON</small></div>
    <div className="gateway-card gateway-card--star"><span>XVII</span><Star /><small>THE STAR</small></div>
    <div className="gateway-card gateway-card--sun"><span>XIX · THE SUN</span><div className="gateway-card__sun"><Sun /><i /><i /></div><small>向内看见 · 向外生长</small></div>
    <div className="gateway-art__seal"><Sparkles /></div>
    <span className="gateway-art__note gateway-art__note--tarot">THE LANGUAGE OF SYMBOLS</span>
    <span className="gateway-art__note gateway-art__note--stars">A MAP TO YOUR INNER WORLD</span>
  </div>;
}

export function Auth({ setupRequired, onAuthenticated }: {
  setupRequired: boolean;
  onAuthenticated: (user: User) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const result = await api<{ user: User }>(setupRequired ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        body: jsonBody(setupRequired ? { username, password, display_name: displayName } : { username, password }),
      });
      onAuthenticated(result.user);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSubmitting(false); }
  };

  return <main className="gateway">
    <div className="gateway__stars" aria-hidden="true" />
    <header className="gateway-header"><Brand /><span className="gateway-header__tag"><i />一方秘境，万千可能</span></header>
    <div className="gateway-layout">
      <section className="gateway-story" aria-label="秘域 · 塔罗与星座">
        <div className="gateway-copy"><span className="gateway-eyebrow"><i />TAROT MEETS THE COSMOS</span><h1>以牌为镜，<br /><span>以星为引。</span></h1><p className="hint">在象征与星轨之间，发现属于自己的答案。</p></div>
        <CelestialGateway />
        <div className="gateway-paths"><span><Layers3 /><strong>塔罗</strong><small>灵感与抉择</small></span><i /><span><Orbit /><strong>星座</strong><small>自我与关系</small></span></div>
      </section>
      <section className="gateway-entry" aria-label={setupRequired ? '创建秘域账号' : '登录秘域'}>
        <div className="gateway-entry__frame">
          <div className="gateway-entry__emblem" aria-hidden="true"><Sparkles /><i /></div>
          <div className="gateway-entry__heading"><span className="gateway-eyebrow">{setupRequired ? 'A NEW BEGINNING' : 'YOUR INNER SANCTUARY'}</span><h2>{setupRequired ? '开启你的秘域' : '欢迎回到秘域'}</h2><p className="hint">{setupRequired ? '创建首位管理员，开启一段新的探索。' : '从一个问题，开启新的探索。'}</p></div>
          <form className="gateway-form" onSubmit={submit} aria-busy={submitting}>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            <Field label="账号"><div className="input-with-icon"><UserRound /><input value={username} onChange={event => setUsername(event.target.value)} required autoComplete="username" placeholder="请输入账号" maxLength={64} disabled={submitting} /></div></Field>
            {setupRequired && <Field label="如何称呼你"><div className="input-with-icon"><Sparkles /><input value={displayName} onChange={event => setDisplayName(event.target.value)} required autoComplete="nickname" placeholder="你的昵称" maxLength={64} disabled={submitting} /></div></Field>}
            <Field label="密码" hint={setupRequired ? '请妥善保存，首次账号将拥有管理权限' : undefined}>
              <div className="input-with-icon input-with-icon--action"><KeyRound /><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required autoComplete={setupRequired ? 'new-password' : 'current-password'} placeholder="请输入密码" disabled={submitting} /><IconButton type="button" label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff /> : <Eye />}</IconButton></div>
            </Field>
            <Button type="submit" className="gateway-form__submit" loading={submitting}>{setupRequired ? '创建并进入秘域' : '进入秘域'}<ArrowRight /></Button>
          </form>
          <div className="gateway-entry__footnote"><span /><Sparkles aria-hidden="true" /><small>给内心一点空间，让答案慢慢浮现</small><span /></div>
        </div>
        <span className="gateway-entry__caption">TWO PATHS. ONE INNER UNIVERSE.</span>
      </section>
    </div>
    <footer className="gateway-footer"><span>秘域 · 每一次探索，都更靠近自己</span><span>Mysterious Realm · TAROT & ASTROLOGY</span></footer>
  </main>;
}
