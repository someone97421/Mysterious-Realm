import { ArrowLeft, ArrowRight, Check, Shuffle, Sparkles, WandSparkles } from 'lucide-react';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { api, jsonBody } from '../api';
import type { Draw, TarotCard } from '../types';
import { cx, errorMessage, useReducedMotion } from '../utils';
import { Button, IconButton, InlineNotice, Modal } from './ui';
import { CardBack, CardFace } from './CardFace';
import './Ceremony.css';

const DECK_SIZE = 78;
type Phase = 'loading' | 'ready' | 'shuffle' | 'choose' | 'flipping' | 'complete';
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
  const [focused, setFocused] = useState<number | null>(null);
  const [inspected, setInspected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [skipping, setSkipping] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const drag = useRef({ x: 0, scroll: 0, active: false, moved: false });
  const revealPromise = useRef<Promise<Draw> | null>(null);
  const snapshot = useRef(draw);
  const onRevealedRef = useRef(onRevealed);
  onRevealedRef.current = onRevealed;
  const total = result?.cards.length ?? draw.positions.length;
  const used = new Set(picks.map((pick) => pick.slot));
  const shownCard = picks[inspected ?? picks.length - 1]?.card;
  const showFace = Boolean(shownCard && focused === null && phase !== 'ready' && phase !== 'shuffle');
  const position = result?.positions[picks.length] ?? draw.positions[picks.length];

  useEffect(() => {
    let active = true;
    setError('');
    setResult(null);
    setPicks([]);
    setFocused(null);
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
      setPhase('ready');
    }).catch((reason) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [attempt, conversationId, draw.id]);

  useEffect(() => {
    if (phase !== 'shuffle') return;
    const timer = window.setTimeout(() => setPhase('choose'), reducedMotion ? 0 : 1500);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion]);

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
    if (phase !== 'choose' || used.has(slot) || busy.current) return;
    setInspected(null);
    setFocused(slot);
  };

  const revealSelected = () => {
    if (phase !== 'choose' || !result || focused === null || used.has(focused) || busy.current) return;
    const card = result.cards[picks.length];
    if (!card) return;
    busy.current = true;
    setPicks((previous) => [...previous, { slot: focused, card }]);
    setFocused(null);
    setInspected(null);
    setPhase('flipping');
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
    drag.current.active = false;
    drag.current.moved = false;
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, active: true, moved: false };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    if (!(event.buttons & 1)) { drag.current.active = false; return; }
    const delta = event.clientX - drag.current.x;
    if (Math.abs(delta) > 6) {
      drag.current.moved = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.scrollLeft = drag.current.scroll - delta;
    }
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    drag.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const action = () => {
    if (phase === 'ready') setPhase(reducedMotion ? 'choose' : 'shuffle');
    else if (phase === 'choose') revealSelected();
    else if (phase === 'complete' && result) onFinish(result);
  };
  const actionLabel = phase === 'loading' ? '星牌归位中' : phase === 'ready' ? '洗牌与展牌' : phase === 'shuffle' ? '正在洗牌' : phase === 'flipping' ? '星牌正在显现' : phase === 'complete' ? '查看完整牌阵' : focused === null ? '先选中一张牌' : '揭开这张牌';
  const hint = error ? '请重新连接星牌' : phase === 'ready' ? '让心绪沉静，再将牌交给直觉' : phase === 'shuffle' ? '星轨交错，等待此刻的相逢' : phase === 'flipping' ? `${shownCard?.position} · ${shownCard?.name_zh}` : phase === 'complete' ? `${total} 张星牌已就位` : phase === 'choose' ? `第 ${picks.length + 1} 位 · ${position || '凭直觉选择'}` : '正在请星牌归位';
  const deckVisible = phase === 'choose' || phase === 'flipping' || phase === 'complete';

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
            <strong>{showFace ? `${shownCard?.name_zh} · ${shownCard?.orientation_zh}` : focused !== null ? `第 ${focused + 1} 张 · 等待揭晓` : phase === 'shuffle' ? '星牌正在交汇' : '聆听直觉的回声'}</strong>
            <small>{showFace ? shownCard?.position : '✧ ASTRAL VEIL ✧'}</small>
          </div>
        </div>
        <div className={cx('ceremony-deck', !deckVisible && 'is-veiled')}>
          <div className="ceremony-deck__heading"><span>{DECK_SIZE - picks.length} 张待选</span><small>左右滑动 · 选中后揭牌</small><div><IconButton label="向前浏览牌池" onClick={() => browse(-1)} disabled={!deckVisible}><ArrowLeft /></IconButton><IconButton label="向后浏览牌池" onClick={() => browse(1)} disabled={!deckVisible}><ArrowRight /></IconButton></div></div>
          <div className="ceremony-deck__rail" ref={deckRef} role="group" aria-label="78 张星牌，左右浏览后选择" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current.active = false; }} onClickCapture={(event) => { if (drag.current.moved) { event.preventDefault(); event.stopPropagation(); drag.current.moved = false; } }}>
            {Array.from({ length: DECK_SIZE }, (_, slot) => <button type="button" key={slot} data-slot={slot} className={cx('ceremony-slot', focused === slot && 'is-focused', used.has(slot) && 'is-used')} aria-label={`第 ${slot + 1} 张星牌${used.has(slot) ? '，已抽取' : ''}`} aria-pressed={focused === slot} disabled={phase !== 'choose' || used.has(slot) || skipping} onClick={() => selectSlot(slot)}><CardBack /><span>{used.has(slot) ? <Check /> : String(slot + 1).padStart(2, '0')}</span></button>)}
          </div>
        </div>
        <div className="ceremony-tray" ref={trayRef} aria-label="已抽取的牌">
          {picks.length === 0 ? <span className="ceremony-tray__empty"><Sparkles />属于你的星牌，将在这里相遇</span> : picks.map(({ slot, card }, index) => <button type="button" key={slot} disabled={phase === 'flipping' || skipping} className={cx('ceremony-tray__card', showFace && shownCard?.id === card.id && 'is-current')} aria-label={`查看第 ${index + 1} 张：${card.position}，${card.name_zh}`} onClick={() => { setFocused(null); setInspected(index); }}><CardFace card={card} showName={false} /><span><small>{String(index + 1).padStart(2, '0')}</small>{card.name_zh}</span></button>)}
        </div>
        {error && <div className="ceremony-error"><InlineNotice tone="error">{error}</InlineNotice><Button onClick={() => setAttempt((value) => value + 1)}>重新连接</Button></div>}
      </div>
      <footer className="ceremony-footer">
        <span className="ceremony-hint" role="status" title={hint}>{hint}</span>
        <div className="ceremony-footer__actions"><IconButton label="凭直觉为我选中一张" disabled={phase !== 'choose' || skipping} onClick={chooseByFeeling}><WandSparkles /></IconButton><Button onClick={action} disabled={!!error || skipping || phase === 'loading' || phase === 'shuffle' || phase === 'flipping' || (phase === 'choose' && focused === null)}>{phase === 'ready' ? <Shuffle /> : <Sparkles />}{actionLabel}<ArrowRight /></Button></div>
      </footer>
    </Modal>
  );
}
