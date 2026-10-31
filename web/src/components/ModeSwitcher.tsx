import { Layers3, Orbit } from 'lucide-react';
import { useState } from 'react';
import type { Mode } from '../types';
import { cx, errorMessage } from '../utils';

const modeMeta: Record<Mode, { label: string; short: string; icon: typeof Layers3 }> = {
  tarot: { label: '塔罗', short: '牌阵', icon: Layers3 },
  astrology: { label: '星座', short: '星盘', icon: Orbit },
};

export function ModeMark({ mode, className }: { mode: Mode; className?: string }) {
  const Icon = modeMeta[mode].icon;
  return <span className={cx('mode-mark', `mode-mark--${mode}`, className)} aria-hidden="true"><Icon /></span>;
}

export function ModeSwitcher({ mode, onSwitch, disabled = false }: { mode: Mode; onSwitch: (mode: Mode) => Promise<void> | void; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const choose = async (next: Mode) => {
    if (next === mode || pending || disabled) return;
    setPending(true);
    setError('');
    try {
      await onSwitch(next);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  };
  return <div className={cx('mode-switcher', `mode-switcher--${mode}`, pending && 'is-switching')} role="group" aria-label="工作模式">
    <span className="mode-switcher__halo" aria-hidden="true" />
    {(Object.keys(modeMeta) as Mode[]).map(value => {
      const meta = modeMeta[value];
      const Icon = meta.icon;
      return <button type="button" key={value} className={cx('mode-switcher__option', mode === value && 'is-active')} aria-pressed={mode === value} disabled={disabled || pending} onClick={() => void choose(value)}>
        <Icon aria-hidden="true" />
        <span><strong>{meta.label}</strong><small>{meta.short}</small></span>
      </button>;
    })}
    {error && <span className="mode-switcher__error" role="alert">{error}</span>}
  </div>;
}
