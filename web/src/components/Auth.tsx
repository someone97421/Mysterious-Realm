import { ArrowRight, Eye, EyeOff, KeyRound, Sparkles, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, jsonBody } from '../api';
import type { User } from '../types';
import { errorMessage } from '../utils';
import { Brand, Button, Field, IconButton, InlineNotice } from './ui';

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
    setError('');
    setSubmitting(true);
    try {
      const result = await api<{ user: User }>(
        setupRequired ? '/api/auth/setup' : '/api/auth/login',
        {
          method: 'POST',
          body: jsonBody(setupRequired ? { username, password, display_name: displayName } : { username, password }),
        },
      );
      onAuthenticated(result.user);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-page__stars" aria-hidden="true" />
      <section className="auth-story" aria-label="星帷塔罗">
        <Brand />
        <div className="auth-orbit" aria-hidden="true">
          <span className="auth-orbit__ring" />
          <span className="auth-orbit__card auth-orbit__card--one">✧</span>
          <span className="auth-orbit__card auth-orbit__card--two">☾</span>
          <span className="auth-orbit__card auth-orbit__card--three">✦</span>
          <Sparkles className="auth-orbit__spark" />
        </div>
        <div className="auth-story__copy">
          <span className="eyebrow">在星幕之下，听见内心</span>
          <h1>每一张牌，<br />都是通向自己的<span>微光。</span></h1>
          <p>让未尽的问题，在牌面与星轨之间找到回声。</p>
        </div>
      </section>
      <section className="auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form__mobile-brand"><Brand compact /></div>
          <span className="eyebrow">{setupRequired ? '初次相逢' : '欢迎归来'}</span>
          <h2>{setupRequired ? '点亮你的星帷' : '再次进入星帷'}</h2>
          <p className="auth-form__lead">{setupRequired ? '创建首位管理员账号，开启这段旅程。' : '今夜，你想倾听什么？'}</p>
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <Field label="账号">
            <div className="input-with-icon"><UserRound /><input value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" placeholder="请输入账号" maxLength={64} /></div>
          </Field>
          {setupRequired && (
            <Field label="如何称呼你">
              <div className="input-with-icon"><Sparkles /><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required placeholder="你的昵称" maxLength={64} /></div>
            </Field>
          )}
          <Field label="密码" hint={setupRequired ? '请妥善保存，首次账号将拥有管理权限' : undefined}>
            <div className="input-with-icon input-with-icon--action">
              <KeyRound />
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete={setupRequired ? 'new-password' : 'current-password'} placeholder="请输入密码" />
              <IconButton type="button" label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</IconButton>
            </div>
          </Field>
          <Button type="submit" className="auth-form__submit" loading={submitting}>
            {setupRequired ? '创建并进入' : '进入星帷'}<ArrowRight />
          </Button>
        </form>
        <footer className="auth-panel__footer">A QUIET SPACE FOR YOUR INNER VOICE</footer>
      </section>
    </main>
  );
}
