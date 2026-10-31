import { ArrowUpRight, CalendarRange, Compass, Link2, Orbit, UsersRound } from 'lucide-react';
import type { Profile, AstroReading, ReadingLayout, ReadingSection, ReadingSource } from '../types';
import { RichText } from './RichText';

interface ReadingLinks { profiles: Profile[]; onProfile: (profile: Profile) => void; onPlanet: (id: string) => void }

const layoutMeta: Record<ReadingLayout, { label: string; icon: typeof Orbit }> = {
  natal: { label: '本命解读', icon: Orbit },
  relationship: { label: '关系合盘', icon: UsersRound },
  forecast: { label: '行运展望', icon: CalendarRange },
  decision: { label: '抉择参考', icon: Compass },
};

function SectionContent({ section, ...links }: { section: ReadingSection } & ReadingLinks) {
  return <>{section.title && <h3>{section.title}</h3>}{section.body && <RichText text={section.body} {...links} />}{!!section.highlights?.length && <ul className="reading-highlights">{section.highlights.filter(Boolean).map((item, index) => <li key={`${index}-${item}`}><RichText text={item} {...links} /></li>)}</ul>}</>;
}

function Actions({ actions, decision = false, disabled = false, onAction }: { actions: string[]; decision?: boolean; disabled?: boolean; onAction?: (text: string) => void }) {
  const items = actions.filter(Boolean);
  if (!items.length) return null;
  return <div className={decision ? 'reading-actions reading-actions--decision' : 'reading-actions'}><h3>{decision ? '可继续厘清的方向' : '继续探索'}</h3><div>{items.map((action, index) => onAction ? <button type="button" disabled={disabled} key={`${index}-${action}`} onClick={() => onAction(action)}><span>{decision ? String(index + 1).padStart(2, '0') : action}</span>{decision && <span>{action}</span>}<ArrowUpRight aria-hidden="true" /></button> : <span key={`${index}-${action}`}>{action}</span>)}</div></div>;
}

function sourceUrl(source: ReadingSource) {
  return /^https?:\/\//i.test(source.url) ? source.url : '';
}

export function ReadingPanel({ reading, preview = false, actionDisabled = false, onAction, ...links }: { reading: Partial<AstroReading>; preview?: boolean; actionDisabled?: boolean; onAction?: (text: string) => void } & ReadingLinks) {
  const layout = reading.layout && layoutMeta[reading.layout] ? reading.layout : 'natal';
  const meta = layoutMeta[layout];
  const Icon = meta.icon;
  const sections = (reading.sections || []).filter(section => section && typeof section === 'object');
  const actions = reading.actions || [];
  const sources = (reading.sources || []).filter(source => source?.name && sourceUrl(source));
  return <article className={`reading-panel reading-panel--${layout} ${preview ? 'is-preview' : ''}`} aria-label={reading.title || meta.label} aria-busy={preview}>
    <header className="reading-hero"><div className="reading-hero__mark"><Icon aria-hidden="true" /></div><div><span className="eyebrow">{preview ? `${meta.label} · 正在生成` : meta.label}</span>{reading.title && <h2>{reading.title}</h2>}{reading.subtitle && <p>{reading.subtitle}</p>}</div></header>
    {reading.summary && <div className="reading-summary"><RichText text={reading.summary} {...links} /></div>}
    {!reading.title && !reading.summary && !sections.length && <div className="reading-pending" role="status"><i /><i /><i /><span>正在整理已到达的解读…</span></div>}
    {layout === 'natal' && <div className="reading-natal-grid">{sections.map((section, index) => <section key={section.id || index}><span className="reading-section-index">{String(index + 1).padStart(2, '0')}</span><SectionContent section={section} {...links} /></section>)}</div>}
    {layout === 'relationship' && <div className="reading-relationship-flow">{sections.map((section, index) => <section key={section.id || index}><span className="reading-relation-node" aria-hidden="true"><i /><i /></span><SectionContent section={section} {...links} /></section>)}</div>}
    {layout === 'forecast' && <ol className="reading-forecast-line">{sections.map((section, index) => <li key={section.id || index}><span className="reading-time-marker" aria-hidden="true" /><section><SectionContent section={section} {...links} /></section></li>)}</ol>}
    {layout === 'decision' && <div className="reading-decision-layout"><div className="reading-decision-sections">{sections.map((section, index) => <section key={section.id || index}><span className="reading-section-index">{String(index + 1).padStart(2, '0')}</span><SectionContent section={section} {...links} /></section>)}</div><Actions actions={actions} decision disabled={actionDisabled} onAction={onAction} /></div>}
    {layout !== 'decision' && <Actions actions={actions} disabled={actionDisabled} onAction={onAction} />}
    {reading.closing && <div className="reading-closing"><RichText text={reading.closing} {...links} /></div>}
    {!!sources.length && <footer className="reading-sources"><span><Link2 aria-hidden="true" />资料来源</span><div>{sources.map((source, index) => <a key={`${index}-${source.url}`} href={sourceUrl(source)} target="_blank" rel="noreferrer">{source.name}<ArrowUpRight aria-hidden="true" /></a>)}</div></footer>}
  </article>;
}
