import { Activity, ArrowDownToLine, ArrowUpFromLine, BarChart3, Database, Info, Repeat2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ModelConfig, UsageRow, UsageStats, User } from '../types';
import { errorMessage, formatCacheRate, formatDate, formatNumber } from '../utils';
import { Button, EmptyState, InlineNotice, LoadingBlock } from './ui';

const purposeNames: Record<string, string> = { chat: '普通聊天', draw: '牌阵', reading: '解读', interpret: '解读', compression: '压缩', check: '连接检查' };
function CacheHint() { return <span className="cache-hint has-tooltip" tabIndex={0} aria-label="缓存命中率说明" data-tooltip="仅根据具有完整 cache usage 的请求计算；未报告缓存的请求不计入"><Info /></span>; }
function UsageTable({ title, rows }: { title: string; rows: UsageRow[] }) {
  return <section className="stats-section"><header><h2>{title}</h2><span>缓存命中率 <CacheHint /></span></header>{rows.length === 0 ? <EmptyState title="当前筛选下暂无数据" /> : <><div className="stats-table-wrap"><table className="stats-table"><thead><tr><th>名称</th><th>输入</th><th>输出</th><th>缓存 Tokens</th><th>缓存命中率</th><th>请求数</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.label}-${index}`}><td>{row.label}</td><td>{formatNumber(row.input_tokens)}</td><td>{formatNumber(row.output_tokens)}</td><td>{formatNumber(row.cached_tokens)}</td><td>{formatCacheRate(row.cache_hit_rate)}</td><td>{formatNumber(row.requests)}</td></tr>)}</tbody></table></div><div className="stats-mobile-rows">{rows.map((row, index) => <article key={`${row.label}-${index}`}><h3>{row.label}</h3><dl><div><dt>输入</dt><dd>{formatNumber(row.input_tokens)}</dd></div><div><dt>输出</dt><dd>{formatNumber(row.output_tokens)}</dd></div><div><dt>缓存</dt><dd>{formatNumber(row.cached_tokens)}</dd></div><div><dt>命中率</dt><dd>{formatCacheRate(row.cache_hit_rate)}</dd></div><div><dt>请求</dt><dd>{formatNumber(row.requests)}</dd></div></dl></article>)}</div></>}</section>;
}

export function StatsAdmin({ users, models }: { users: User[]; models: ModelConfig[] }) {
  const [days, setDays] = useState(30);
  const [userId, setUserId] = useState('');
  const [modelId, setModelId] = useState('');
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const query = new URLSearchParams({ days: String(days), user_id: userId, model_id: modelId });
    api<UsageStats>(`/api/admin/stats?${query}`, { signal: controller.signal }).then((result) => { setStats(result); setError(''); }).catch((reason) => { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, userId, modelId, attempt]);
  const maxDaily = Math.max(1, ...(stats?.daily.map((row) => row.input_tokens + row.output_tokens) ?? [0]));
  return <section>
    <header className="admin-section-header"><div><span className="eyebrow">TOKEN OBSERVATORY</span><h1>Token 统计</h1><p>观测每一次连接与回应的消耗。</p></div></header>
    <form className="stats-filters" onSubmit={(event) => event.preventDefault()}><label>时间范围<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></label><label>成员<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">全部成员</option>{users.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}</select></label><label>模型<select value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">全部模型</option>{models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label></form>
    {error && <InlineNotice tone="error">{error}<Button variant="ghost" onClick={() => setAttempt((value) => value + 1)}>重试</Button></InlineNotice>}
    {loading && !stats && <LoadingBlock className="admin-loading" />}
    {stats && <div className={loading ? 'stats-data is-refreshing' : 'stats-data'}>
      <div className="metric-grid">
        <article><span><ArrowUpFromLine />输入 Tokens</span><strong>{formatNumber(stats.totals.input_tokens)}</strong><small>所有请求输入</small></article>
        <article><span><ArrowDownToLine />输出 Tokens</span><strong>{formatNumber(stats.totals.output_tokens)}</strong><small>所有请求输出</small></article>
        <article><span><Database />缓存 Tokens</span><strong>{formatNumber(stats.totals.cached_tokens)}</strong><small>命中率 {formatCacheRate(stats.totals.cache_hit_rate)} <CacheHint /></small></article>
        <article><span><Repeat2 />请求次数</span><strong>{formatNumber(stats.totals.requests)}</strong><small>含估算 {formatNumber(stats.totals.estimated_requests)} 次</small></article>
      </div>
      <section className="daily-chart"><header><h2><Activity />每日 Token 趋势</h2><span>输入 + 输出</span></header>{stats.daily.length === 0 ? <EmptyState title="暂无每日用量" /> : <div className="daily-chart__bars">{stats.daily.map((row, index) => <div key={`${row.label}-${index}`}><span className="daily-chart__value">{formatNumber(row.input_tokens + row.output_tokens)}</span><div><i style={{ '--bar-size': `${Math.max(2, ((row.input_tokens + row.output_tokens) / maxDaily) * 100)}%` } as React.CSSProperties} /></div><time>{formatDate(row.label)}</time></div>)}</div>}</section>
      <UsageTable title="按成员" rows={stats.by_user} /><UsageTable title="按模型" rows={stats.by_model} />
      <section className="stats-section"><header><h2>最近请求</h2><span>包含聊天、牌阵、解读、压缩与连接检查</span></header>{stats.recent.length === 0 ? <EmptyState icon={<BarChart3 />} title="暂无请求记录" /> : <><div className="stats-table-wrap"><table className="stats-table stats-table--recent"><thead><tr><th>时间</th><th>成员</th><th>模型 / 用途</th><th>输入</th><th>输出</th><th>缓存 Tokens</th><th>计量</th></tr></thead><tbody>{stats.recent.map((event) => <tr key={event.id}><td>{formatDate(event.created_at, true)}</td><td>{event.username}</td><td><strong>{event.model_name}</strong><small>{purposeNames[event.purpose] ?? event.purpose}</small></td><td>{formatNumber(event.input_tokens)}</td><td>{formatNumber(event.output_tokens)}</td><td>{event.cached_tokens === null ? '未提供' : formatNumber(event.cached_tokens)}</td><td>{event.estimated ? <span className="estimated-badge">估算</span> : '精确'}</td></tr>)}</tbody></table></div><div className="stats-mobile-rows">{stats.recent.map((event) => <article key={event.id}><header><h3>{event.model_name}</h3>{event.estimated && <span className="estimated-badge">估算</span>}</header><p>{event.username} · {purposeNames[event.purpose] ?? event.purpose} · {formatDate(event.created_at, true)}</p><dl><div><dt>输入</dt><dd>{formatNumber(event.input_tokens)}</dd></div><div><dt>输出</dt><dd>{formatNumber(event.output_tokens)}</dd></div><div><dt>缓存</dt><dd>{event.cached_tokens === null ? '未提供' : formatNumber(event.cached_tokens)}</dd></div></dl></article>)}</div></>}</section>
    </div>}
  </section>;
}
