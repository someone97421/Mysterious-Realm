import { useEffect, useState } from 'react';
import type { Chart, Planet } from '../types';
import { useReducedMotion } from '../utils';
import { AstroSymbol } from './AstroSymbol';
import { Button } from './ui';

const signs = [
  ['aries', '白羊座'], ['taurus', '金牛座'], ['gemini', '双子座'], ['cancer', '巨蟹座'],
  ['leo', '狮子座'], ['virgo', '处女座'], ['libra', '天秤座'], ['scorpio', '天蝎座'],
  ['sagittarius', '射手座'], ['capricorn', '摩羯座'], ['aquarius', '水瓶座'], ['pisces', '双鱼座'],
] as const;
const point = (longitude: number, radius: number) => ({ x: 250 - Math.cos(longitude * Math.PI / 180) * radius, y: 250 + Math.sin(longitude * Math.PI / 180) * radius });
const valid = (p: { longitude: number }) => Number.isFinite(p.longitude) && p.longitude >= 0 && p.longitude < 360;

function labelPositions(planets: Planet[]) {
  const ordered = [...planets].sort((a, b) => a.longitude - b.longitude);
  if (!ordered.length) return new Map<string, number>();
  let start = 0; let largest = -1;
  ordered.forEach((p, i) => { const next = ordered[(i + 1) % ordered.length].longitude + (i === ordered.length - 1 ? 360 : 0); if (next - p.longitude > largest) { largest = next - p.longitude; start = (i + 1) % ordered.length; } });
  const rotated = [...ordered.slice(start), ...ordered.slice(0, start)];
  const gap = Math.min(9, 340 / rotated.length);
  const values = rotated.map(p => p.longitude < rotated[0].longitude ? p.longitude + 360 : p.longitude);
  for (let i = 1; i < values.length; i++) values[i] = Math.max(values[i], values[i - 1] + gap);
  const end = values[0] + 360 - gap;
  if (values[values.length - 1] > end) { values[values.length - 1] = end; for (let i = values.length - 2; i >= 0; i--) values[i] = Math.min(values[i], values[i + 1] - gap); }
  return new Map(rotated.map((p, i) => [p.id, values[i] % 360] as const));
}

export function ChartView({ chart, selected, onSelect, reveal, onRevealed }: { chart: Chart | undefined; selected: string; onSelect: (id: string) => void; reveal: boolean; onRevealed: () => void }) {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState('');
  useEffect(() => { if (!reveal) return; if (reduced) { onRevealed(); return; } const timer = window.setTimeout(onRevealed, 1500); return () => window.clearTimeout(timer); }, [reveal, reduced, onRevealed]);
  const planets = (chart?.planets || []).filter(valid);
  const outer = (chart?.outer_planets || []).filter(valid);
  const all = [...planets, ...outer];
  const active = hover || selected;
  const current = all.find(p => p.id === active);
  const innerLabels = labelPositions(planets); const outerLabels = labelPositions(outer);
  const planetNode = (p: Planet, outside = false) => {
    const position = point((outside ? outerLabels : innerLabels).get(p.id) ?? p.longitude, outside ? 242 : 165);
    const actual = point(p.longitude, outside ? 222 : 145);
    return <g key={`${outside}-${p.id}`} className={`planet-node ${outside ? 'planet-node--outer' : ''} ${active === p.id ? 'is-selected' : ''}`} role="button" tabIndex={0} aria-label={`${outside ? '外圈 ' : ''}${p.name} ${p.longitude.toFixed(2)}度`} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover('')} onFocus={() => setHover(p.id)} onBlur={() => setHover('')} onClick={() => onSelect(p.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); } }}>
      <title>{p.name} · {p.sign || ''} · {p.longitude.toFixed(2)}°</title>
      <line x1={actual.x} y1={actual.y} x2={position.x} y2={position.y} className="planet-leader" />
      <circle className="planet-position" cx={actual.x} cy={actual.y} r={2} />
      <circle className="planet-disc" cx={position.x} cy={position.y} r={12} />
      <AstroSymbol id={p.id} className="planet-glyph" x={position.x - 8} y={position.y - 8} size={16} />
    </g>;
  };
  const source = chart?.source;
  return <section className="chart-stage" aria-label="星盘">
    <header><span className="eyebrow">星轨 · CELESTIAL MAP</span><h2>{chart?.title || '你的星图，等待展开'}</h2></header>
    {!!outer.length && <small className="hint">内圈 · {chart?.inner_label || '第一位人物'}　外圈 · {chart?.outer_label || '第二位人物'}</small>}
    <div className={`chart-wheel ${reveal && !reduced ? 'is-revealing' : ''}`}>
      {planets.length || outer.length ? <svg viewBox="-12 -12 524 524" className="zodiac-svg" aria-label={chart?.title || '星盘'}>
        <circle cx="250" cy="250" r="237" className="wheel-halo" /><circle cx="250" cy="250" r="222" className="wheel-ring" /><circle cx="250" cy="250" r="190" className="wheel-ring" /><circle cx="250" cy="250" r="145" className="wheel-ring" />
        {Array.from({ length: 72 }, (_, i) => { const a = point(i * 5, 222); const b = point(i * 5, i % 6 === 0 ? 232 : 226); return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="wheel-tick" />; })}
        {signs.map(([id, name], i) => { const p = point(i * 30 + 15, 205); return <g key={id} className="sign-label"><title>{name}</title><AstroSymbol id={id} className="sign-glyph" x={p.x - 10} y={p.y - 10} size={20} /></g>; })}
        {(chart?.houses || []).filter(valid).map(h => { const a = point(h.longitude, 145); const b = point(h.longitude, 190); const label = point(h.longitude + 3, 180); return <g key={h.number}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="house-line" /><text x={label.x} y={label.y} className="house-label">{h.number}</text></g>; })}
        {(chart?.aspects || []).map((aspect, i) => { const from = all.find(p => p.id === aspect.from); const to = all.find(p => p.id === aspect.to); if (!from || !to) return null; const a = point(from.longitude, 145); const b = point(to.longitude, 145); return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`aspect-line ${active === from.id || active === to.id ? 'is-highlighted' : ''}`}><title>{from.name} / {to.name} · {aspect.angle}°</title></line>; })}
        {planets.map(p => planetNode(p))}{outer.map(p => planetNode(p, true))}
      </svg> : <div className="abstract-orbit" aria-hidden="true"><i /><i /><i /><svg className="abstract-orbit__spark" viewBox="0 0 24 24"><path d="M12 2c0 7-3 10-10 10 7 0 10 3 10 10 0-7 3-10 10-10-7 0-10-3-10-10Z" /></svg></div>}
      {!planets.length && !outer.length && <small className="hint">{chart ? '尚无可绘制的星位数据' : '引用人物，开始一次探索'}</small>}
    </div>
    {reveal && !reduced && <Button variant="ghost" onClick={onRevealed}>跳过揭示</Button>}
    {chart && <><div className="planet-detail" aria-live="polite">{current ? <><strong>{current.name}{current.retrograde ? ' · 逆行' : ''}</strong><span>{current.sign || ''} · 黄经 {current.longitude.toFixed(2)}°{current.house != null ? ` · 第 ${current.house} 宫` : ''}</span></> : <small className="hint">选择行星，查看位置与相位</small>}</div><div className="planet-legend">{all.map(p => <button type="button" key={p.id} aria-pressed={selected === p.id} onClick={() => onSelect(p.id)}><AstroSymbol id={p.id} /><span>{p.name}</span></button>)}</div>
      {current && <div className="aspect-details">{(chart.aspects || []).filter(a => a.from === current.id || a.to === current.id).map((a, i) => <small key={i}>{all.find(p => p.id === a.from)?.name} · {all.find(p => p.id === a.to)?.name} {a.angle}°{a.orb != null ? ` / 容许度 ${a.orb}°` : ''}</small>)}</div>}
      <footer className="chart-footnote">{source && <small className="chart-source">来源 · {source.name}</small>}{(chart.warnings || []).map((warning, i) => <small className="hint" key={i} data-tooltip={warning}>{warning.length > 64 ? `${warning.slice(0, 64)}…` : warning}</small>)}</footer></>}
  </section>;
}
