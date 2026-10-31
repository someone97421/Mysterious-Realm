import { ArrowLeft, ArrowRight, Check, Shuffle, Sparkles, WandSparkles } from 'lucide-react';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { api, jsonBody } from '../api';
import type { Draw, TarotCard } from '../types';
import { cx, errorMessage, useReducedMotion } from '../utils';
import { Button, IconButton, InlineNotice, Modal } from './ui';
import { CardBack, CardFace } from './CardFace';
import './Ceremony.css';

const DECK_SIZE = 78;
type Phase = 'loading' | 'shuffle' | 'choose' | 'lifting' | 'flipping' | 'complete';
interface Pick { slot: number; card: TarotCard }

export function Ceremony({ draw, conversationId, onRevealed, onFinish, onClose }: {
  draw: Draw;
  conversationId: string;
  onRevealed: (draw: Draw) => void;
  onFinish: (draw: Draw) => void;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('loading');
  const [result, setResult] = useState<Draw | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [inspected, setInspected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [skipping, setSkipping] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const drag = useRef({ id: -1, x: 0, y: 0, scroll: 0, started: 0, slot: null as number | null, mouse: false, active: false, moved: false, cancelled: false });
  const lastScrollAt = useRef(0);
  const revealPromise = useRef<Promise<Draw> | null>(null);
  const snapshot = useRef(draw);
  const onRevealedRef = useRef(onRevealed);
  onRevealedRef.current = onRevealed;
  const total = result?.cards.length ?? draw.positions.length;
  const used = new Set(picks.map((pick) => pick.slot));
  const shownCard = picks[inspected ?? picks.length - 1]?.card;
  const showFace = Boolean(shownCard && phase !== 'lifting' && phase !== 'shuffle');
  const position = result?.positions[picks.length] ?? draw.positions[picks.length];

  useEffect(() => {
    let active = true;
    setError('');
    setResult(null);
    setPicks([]);
    setInspected(null);
    setPhase('loading');
    busy.current = false;
    const current = snapshot.current;
    const request = (current.status === 'proposed'
      ? api<Draw>(`/api/conversations/${conversationId}/draws/${current.id}/reveal`, { method: 'POST', body: jsonBody({}) })
      : Promise.resolve(current)).then((revealed) => {
        if (!revealed.cards.length || revealed.cards.length > DECK_SIZE || revealed.cards.length !== revealed.positions.length) {
          throw new Error('牌阵数量未能对应，请重新连接');
        }
        return revealed;
      });
    revealPromise.current = request;
    request.then((revealed) => {
      onRevealedRef.current(revealed);
      if (!active) return;
      setResult(revealed);
      setPhase('shuffle');
    }).catch((reason) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [attempt, conversationId, draw.id]);

  useEffect(() => {
    if (phase !== 'shuffle') return;
    const timer = window.setTimeout(() => setPhase('choose'), 3000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'lifting') return;
    const timer = window.setTimeout(() => setPhase('flipping'), 80);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const rail = deckRef.current;
    if (!rail) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || rail.scrollWidth <= rail.clientWidth) return;
      const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!delta) return;
      event.preventDefault();
      drag.current.cancelled = true;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientWidth : 1;
      rail.scrollLeft += delta * scale;
    };
    rail.addEventListener('wheel', onWheel, { passive: false });
    return () => rail.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (phase !== 'flipping') return;
    const timer = window.setTimeout(() => {
      busy.current = false;
      setPhase(picks.length >= total ? 'complete' : 'choose');
    }, reducedMotion ? 120 : 1250);
    return () => window.clearTimeout(timer);
  }, [phase, picks.length, total, reducedMotion]);

  useEffect(() => {
    const tray = trayRef.current;
    if (tray) tray.scrollLeft = tray.scrollWidth;
  }, [picks.length]);

  const selectSlot = (slot: number) => {
    if (phase !== 'choose' || !result || used.has(slot) || busy.current || skipping) return;
    const card = result.cards[picks.length];
    if (!card) return;
    busy.current = true;
    setPicks((previous) => [...previous, { slot, card }]);
    setInspected(null);
    setPhase('lifting');
  };

  const chooseByFeeling = () => {
    const available = Array.from({ length: DECK_SIZE }, (_, index) => index).filter((slot) => !used.has(slot));
    if (!available.length || phase !== 'choose') return;
    const slot = available[Math.floor(Math.random() * available.length)];
    selectSlot(slot);
    const rail = deckRef.current;
    const button = rail?.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    if (rail && button) rail.scrollTo({ left: button.offsetLeft - rail.clientWidth / 2 + button.clientWidth / 2, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const skip = async () => {
    if (!revealPromise.current || skipping) return;
    setSkipping(true);
    try { onFinish(await revealPromise.current); }
    catch (reason) { setError(errorMessage(reason)); setSkipping(false); }
  };

  const browse = (direction: number) => {
    const rail = deckRef.current;
    rail?.scrollBy({ left: direction * rail.clientWidth * .7, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) { drag.current.cancelled = true; return; }
    if (event.button !== 0) return;
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slot]') : null;
    const now = performance.now();
    drag.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY, scroll: event.currentTarget.scrollLeft,
      started: now, slot: button ? Number(button.dataset.slot) : null, mouse: event.pointerType === 'mouse',
      active: true, moved: false, cancelled: event.pointerType !== 'mouse' && now - lastScrollAt.current < 120,
    };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (!gesture.active || gesture.id !== event.pointerId) return;
    if (gesture.mouse && !(event.buttons & 1)) { gesture.active = false; gesture.cancelled = true; return; }
    const dx = event.clientX - gesture.x;
    if (Math.hypot(dx, event.clientY - gesture.y) > 8) gesture.moved = true;
    if (gesture.mouse && gesture.moved) {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.scrollLeft = gesture.scroll - dx;
    }
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (gesture.id !== event.pointerId) return;
    gesture.moved ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8 || Math.abs(event.currentTarget.scrollLeft - gesture.scroll) > 3;
    gesture.cancelled ||= event.type === 'pointercancel' || performance.now() - gesture.started > 650;
    gesture.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const action = () => {
    if (phase === 'choose') chooseByFeeling();
    else if (phase === 'complete' && result) onFinish(result);
  };
  const actionLabel = phase === 'loading' ? '星牌归位中' : phase === 'shuffle' ? '正在洗牌' : phase === 'lifting' || phase === 'flipping' ? '星牌正在显现' : phase === 'complete' ? '查看完整牌阵' : '为我抽一张';
  const hint = error ? '请重新连接星牌' : phase === 'shuffle' ? '星轨交错，等待此刻的相逢' : phase === 'lifting' || phase === 'flipping' ? `${shownCard?.position} · ${shownCard?.name_zh}` : phase === 'complete' ? `${total} 张星牌已就位` : phase === 'choose' ? `第 ${picks.length + 1} 位 · ${position || '凭直觉选择'}` : '正在请星牌归位';
  const deckVisible = phase === 'choose' || phase === 'lifting' || phase === 'flipping' || phase === 'complete';

  return (
    <Modal title={draw.spread_name} eyebrow="星牌仪式" onClose={onClose} className="ceremony-modal" closeDisabled={skipping}>
      <div className="ceremony-toolbar">
        <div className="ceremony-progress" role="progressbar" aria-label="抽牌进度" aria-valuemin={0} aria-valuemax={total} aria-valuenow={picks.length}><span style={{ width: `${picks.length / Math.max(total, 1) * 100}%` }} /></div>
        <span className="ceremony-count">{picks.length} / {total}</span>
        <Button variant="ghost" onClick={() => void skip()} loading={skipping} disabled={phase === 'complete' || !!error}>跳过仪式</Button>
      </div>
      <div className={cx('ceremony-stage', `ceremony-stage--${phase}`)}>
        <div className="ceremony-altar">
          <div className="ceremony-orbits" aria-hidden="true"><i /><i /><i /><span>✦</span></div>
          <div className={cx('ceremony-hero', phase === 'shuffle' && 'is-shuffling')} aria-hidden={!shownCard}>
            <div className="ceremony-stack ceremony-stack--one"><CardBack /></div>
            <div className="ceremony-stack ceremony-stack--two"><CardBack /></div>
            <div className={cx('ceremony-hero__inner', showFace && 'is-face')}>
              <div className="ceremony-hero__back" aria-hidden={showFace}><CardBack /></div>
              <div className="ceremony-hero__front" aria-hidden={!showFace}>{shownCard && <CardFace key={shownCard.id} card={shownCard} showName={false} />}</div>
            </div>
          </div>
          <div className="ceremony-hero-caption" aria-live="polite">
            <strong>{showFace ? `${shownCard?.name_zh} · ${shownCard?.orientation_zh}` : phase === 'lifting' ? '星牌正在苏醒' : phase === 'shuffle' ? '星牌正在交汇' : '聆听直觉的回声'}</strong>
            <small>{showFace ? shownCard?.position : '✧ ASTRAL VEIL ✧'}</small>
          </div>
        </div>
        <div className={cx('ceremony-deck', !deckVisible && 'is-veiled')}>
          <div className="ceremony-deck__heading"><span>{DECK_SIZE - picks.length} 张待选</span><small>滑动浏览 · 点击抽牌</small><div><IconButton label="向前浏览牌池" onClick={() => browse(-1)} disabled={!deckVisible}><ArrowLeft /></IconButton><IconButton label="向后浏览牌池" onClick={() => browse(1)} disabled={!deckVisible}><ArrowRight /></IconButton></div></div>
          <div className="ceremony-deck__rail" ref={deckRef} role="group" aria-label="78 张星牌，滑动或滚轮浏览，点击抽牌" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { if (drag.current.active) drag.current.cancelled = true; drag.current.active = false; }} onScroll={(event) => {
            lastScrollAt.current = performance.now();
            if (drag.current.active && Math.abs(event.currentTarget.scrollLeft - drag.current.scroll) > 3) drag.current.moved = true;
          }} onClickCapture={(event) => {
            if (event.detail === 0) return;
            const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slot]') : null;
            const gesture = drag.current;
            if (gesture.active || gesture.moved || gesture.cancelled || !button || gesture.slot !== Number(button.dataset.slot)) {
              event.preventDefault(); event.stopPropagation();
            }
            gesture.slot = null;
          }}>
            {Array.from({ length: DECK_SIZE }, (_, slot) => <button type="button" key={slot} data-slot={slot} className={cx('ceremony-slot', used.has(slot) && 'is-used')} aria-label={`抽取第 ${slot + 1} 张星牌${used.has(slot) ? '，已抽取' : ''}`} disabled={phase !== 'choose' || used.has(slot) || skipping} onClick={() => selectSlot(slot)}><CardBack /><span>{used.has(slot) ? <Check /> : String(slot + 1).padStart(2, '0')}</span></button>)}
          </div>
        </div>
        <div className="ceremony-tray" ref={trayRef} aria-label="已抽取的牌">
          {picks.length === 0 ? <span className="ceremony-tray__empty"><Sparkles />属于你的星牌，将在这里相遇</span> : picks.map(({ slot, card }, index) => <button type="button" key={slot} disabled={phase === 'lifting' || phase === 'flipping' || skipping} className={cx('ceremony-tray__card', showFace && shownCard?.id === card.id && 'is-current')} aria-label={`查看第 ${index + 1} 张：${card.position}，${card.name_zh}`} onClick={() => setInspected(index)}><CardFace card={card} showName={false} /><span><small>{String(index + 1).padStart(2, '0')}</small>{card.name_zh}</span></button>)}
        </div>
        {error && <div className="ceremony-error"><InlineNotice tone="error">{error}</InlineNotice><Button onClick={() => setAttempt((value) => value + 1)}>重新连接</Button></div>}
      </div>
      <footer className="ceremony-footer">
        <span className="ceremony-hint" role="status" data-tooltip={hint}>{hint}</span>
        <div className="ceremony-footer__actions"><Button onClick={action} disabled={!!error || skipping || (phase !== 'choose' && phase !== 'complete')}>{phase === 'shuffle' ? <Shuffle /> : <WandSparkles />}{actionLabel}<ArrowRight /></Button></div>
      </footer>
    </Modal>
  );
}
