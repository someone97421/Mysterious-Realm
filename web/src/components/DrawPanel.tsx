import { ArrowLeft, ArrowRight, BookOpen, Expand, Layers3, Rotate3D, Sparkles, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CardReading, Draw, Reading, TarotCard } from '../types';
import { Button, IconButton, Modal } from './ui';
import { CardBack, CardFace } from './CardFace';

function EnlargedCard({ card, draw, onSelect, onClose }: { card: TarotCard; draw: Draw; onSelect: (card: TarotCard) => void; onClose: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const index = draw.cards.findIndex((item) => item.id === card.id);
  const analysis = draw.reading?.cards.find((item) => item.card_id === card.id);
  const move = (direction: number) => onSelect(draw.cards[(index + direction + draw.cards.length) % draw.cards.length]);
  useEffect(() => { setFlipped(false); }, [card.id, card.position]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.card-viewer') || event.target.closest('[inert]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        onSelect(draw.cards[(index + (event.key === 'ArrowLeft' ? -1 : 1) + draw.cards.length) % draw.cards.length]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [draw, index, onSelect]);
  return (
    <Modal title={`${card.position} · ${card.name_zh}`} eyebrow={card.orientation_zh} onClose={onClose} className="card-viewer">
      <button className="card-viewer__stage" onClick={() => setFlipped((value) => !value)} aria-label={flipped ? '翻看牌面' : '翻看牌背'}>
        <span className={flipped ? 'is-flipped' : ''}>
          <span className="card-viewer__front"><CardFace card={card} showName={false} /></span>
          <span className="card-viewer__back"><CardBack /></span>
        </span>
      </button>
      <div className="card-viewer__footer">
        <span>{card.name_en}</span>
        <Button variant="ghost" onClick={() => setFlipped((value) => !value)}><Rotate3D />{flipped ? '查看牌面' : '查看牌背'}</Button>
      </div>
      <div className="card-viewer__footer">
        <IconButton label="上一张牌" onClick={() => move(-1)} disabled={draw.cards.length < 2}><ArrowLeft /></IconButton>
        <span>{index + 1} / {draw.cards.length}</span>
        <IconButton label="下一张牌" onClick={() => move(1)} disabled={draw.cards.length < 2}><ArrowRight /></IconButton>
      </div>
      {analysis && <article className="reading-card"><dl>
        <div><dt>画面</dt><dd>{analysis.imagery}</dd></div>
        <div><dt>象征</dt><dd>{analysis.symbolism}</dd></div>
        <div><dt>解析</dt><dd>{analysis.interpretation}</dd></div>
        <div><dt>建议</dt><dd>{analysis.advice}</dd></div>
      </dl></article>}
    </Modal>
  );
}

function ReadingDetails({ draw, onExpand, pending = false }: { draw: Draw; onExpand: (card: TarotCard) => void; pending?: boolean }) {
  const reading = draw.reading;
  if (!reading) return null;
  const rows = reading.cards.map((item) => ({
    item,
    card: draw.cards.find((card) => card.id === item.card_id),
  }));
  const cardFor = (item: CardReading) => draw.cards.find((card) => card.id === item.card_id);
  const content = (text: string) => text || <span className="reading-pending" aria-label={pending ? '等待生成' : '尚未生成'}>{pending ? '…' : '—'}</span>;

  return (
    <section className="reading" aria-label="逐牌详细解析" aria-busy={pending}>
      <div className="reading__heading"><BookOpen /><div><span className="eyebrow">星牌解读</span><h3>每一张牌，都有自己的回声</h3></div></div>
      <div className="reading-table-wrap">
        <table className="reading-table">
          <thead><tr><th>牌位与牌面</th><th>画面</th><th>象征</th><th>详细解析</th><th>行动建议</th></tr></thead>
          <tbody>{rows.map(({ item, card }, index) => (
            <tr key={`${item.card_id}-${index}`}>
              <td>
                <strong>{card?.position ?? draw.positions[index] ?? `第 ${index + 1} 张`}</strong>
                <span>{card?.name_zh ?? '星牌'} · {card?.orientation_zh ?? ''}</span>
                {card && <IconButton label={`放大${card.name_zh}`} onClick={() => onExpand(card)}><Expand /></IconButton>}
              </td>
              <td>{content(item.imagery)}</td><td>{content(item.symbolism)}</td><td>{content(item.interpretation)}</td><td>{content(item.advice)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="reading-mobile">
        {reading.cards.map((item, index) => {
          const card = cardFor(item);
          return (
            <article className="reading-card" key={`${item.card_id}-${index}`}>
              <header><span>{String(index + 1).padStart(2, '0')}</span><div><small>{card?.position ?? draw.positions[index]}</small><h4>{card?.name_zh ?? '星牌'} · {card?.orientation_zh}</h4></div>{card && <IconButton label="放大牌面" onClick={() => onExpand(card)}><Expand /></IconButton>}</header>
              <dl><div><dt>画面</dt><dd>{content(item.imagery)}</dd></div><div><dt>象征</dt><dd>{content(item.symbolism)}</dd></div><div><dt>解析</dt><dd>{content(item.interpretation)}</dd></div><div><dt>建议</dt><dd>{content(item.advice)}</dd></div></dl>
            </article>
          );
        })}
      </div>
      {(reading.synthesis || pending) && <div className="reading-synthesis"><Sparkles /><div><h3>牌阵综合</h3><p>{content(reading.synthesis)}</p></div></div>}
      {(reading.actions.length > 0 || pending) && <section className="reading-actions"><h3>带走此刻的微光</h3><ol>{(reading.actions.length ? reading.actions : ['']).map((action, index) => <li key={index}><span>{index + 1}</span>{content(action)}</li>)}</ol></section>}
      {(reading.closing || pending) && <blockquote className="reading-closing">{content(reading.closing)}</blockquote>}
    </section>
  );
}

export function DrawPanel({
  draw,
  onOpenCeremony,
  onInterpret,
  interpreting,
  streamReading,
  streamStatus,
  error,
}: {
  draw: Draw;
  onOpenCeremony: (draw: Draw) => void;
  onInterpret: (draw: Draw) => void;
  interpreting: boolean;
  streamReading?: Reading;
  streamStatus: string;
  error?: string;
}) {
  const [expanded, setExpanded] = useState<TarotCard | null>(null);
  const readingDraw = draw.reading || !streamReading ? draw : { ...draw, reading: streamReading };

  return (
    <article className="draw-panel">
      <header className="draw-panel__header">
        <span className="draw-panel__icon"><Layers3 /></span>
        <div><span className="eyebrow">{draw.spread_name}</span><h2>{draw.question || '此刻的星牌指引'}</h2></div>
        <span className={`status-pill status-pill--${draw.status}`}>{interpreting ? '正在解读' : draw.status === 'proposed' ? '等待抽牌' : draw.status === 'drawn' ? '牌面已揭晓' : '解读完成'}</span>
      </header>
      {draw.opening && <p className="draw-panel__opening">{draw.opening}</p>}
      <div className="spread-positions" aria-label="牌阵位置">
        {draw.positions.map((position, index) => <span key={`${position}-${index}`}><small>{String(index + 1).padStart(2, '0')}</small>{position}</span>)}
      </div>
      {draw.status === 'proposed' && (
        <div className="draw-panel__cta"><Button onClick={() => onOpenCeremony(draw)}><WandSparkles />开启抽牌仪式<ArrowRight /></Button></div>
      )}
      {draw.status !== 'proposed' && draw.cards.length > 0 && (
        <div className="drawn-cards" style={{ '--card-count': draw.cards.length } as React.CSSProperties}>
          {draw.cards.map((card, index) => (
            <button className="drawn-card" key={`${card.id}-${index}`} onClick={() => setExpanded(card)} style={{ '--delay': `${index * 55}ms` } as React.CSSProperties}>
              <span className="drawn-card__position"><small>{String(index + 1).padStart(2, '0')}</small>{card.position || draw.positions[index]}</span>
              <CardFace card={card} />
              <span className="drawn-card__expand"><Expand />放大翻看</span>
            </button>
          ))}
        </div>
      )}
      {draw.status === 'drawn' && (
        <div className="draw-panel__cta">
          {error && <p className="stream-error" role="alert">{error}</p>}
          <Button onClick={() => onInterpret(draw)} loading={interpreting} disabled={interpreting}>
            <BookOpen />{error ? '重新解读' : interpreting ? '星辰正在织语言' : '继续解读牌阵'}<ArrowRight />
          </Button>
          {streamStatus && <span className="stream-status" role="status">{interpreting && <i />}{streamStatus}</span>}
        </div>
      )}
      {readingDraw.reading && <ReadingDetails draw={readingDraw} onExpand={setExpanded} pending={interpreting && !draw.reading} />}
      {expanded && <EnlargedCard card={expanded} draw={readingDraw} onSelect={setExpanded} onClose={() => setExpanded(null)} />}
    </article>
  );
}
