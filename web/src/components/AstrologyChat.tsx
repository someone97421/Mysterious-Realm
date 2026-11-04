import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, CircleAlert, LoaderCircle, LogOut, Menu, Minus, MoonStar, ShieldCheck, UsersRound } from 'lucide-react';
import { api, jsonBody, postSSE } from '../api';
import type { AppConfig, AstroReading, Chart, Conversation, ConversationDetail, LengthMode, Message, Mode, Profile, Progress, User } from '../types';
import { errorMessage, formatDate, isAbortError } from '../utils';
import { Brand, Button, Field, IconButton, InlineNotice, LoadingBlock, Modal } from './ui';
import { ChartView } from './ChartView';
import { ModeSwitcher } from './ModeSwitcher';
import { ConversationCard } from './ConversationCard';
import { NewConversationButtons } from './NewConversationButtons';
import { ProfileComposer, type ComposerHandle } from './ProfileComposer';
import { Profiles, ProfileSummary } from './Profiles';
import { ReadingPanel } from './ReadingPanel';
import { RichText } from './RichText';

const upsert = <T extends { id: string }>(items: T[], value: T) => items.some(item => item.id === value.id) ? items.map(item => item.id === value.id ? value : item) : [...items, value];
const publicText = (text: string) => /(?:sk-[a-z0-9]{16,}|Traceback \(most recent call last\)|Authorization:\s*Bearer\s+\S+|api[_ -]?key\s*[:=]\s*\S+|<think>)/i.test(text) ? '本次探索暂未完成，请稍后继续。' : text;
const timeValue = (value: string) => { const time = Date.parse(value); return Number.isFinite(time) ? time : 0; };

function ProgressLog({ items, working, current }: { items: Progress[]; working: boolean; current: boolean }) {
  return <details className="progress-log" open={working && current}><summary>本次探索进度 · {items.length}</summary><ol>{items.map(progress => { const pending = progress.state === 'running' && !working; return <li key={progress.id} className={`progress-${pending ? 'idle' : progress.state}`}><span aria-hidden="true">{progress.state === 'complete' ? <Check /> : progress.state === 'error' ? <CircleAlert /> : pending ? <Minus /> : <LoaderCircle className="spin" />}</span><div><span>{publicText(progress.text)}</span><time>{formatDate(progress.created_at, true)}</time></div>{pending && <small>（已结束）</small>}</li>; })}</ol></details>;
}

export function AstrologyChat({ user, config, onLogout, onAdmin, onHome, mode, initialConversationId, onOpenConversation, onSwitchMode }: {
  user: User;
  config: AppConfig;
  onLogout: () => void;
  onAdmin: () => void;
  onHome: () => void;
  mode: Mode;
  initialConversationId?: string | null;
  onOpenConversation: (conversation: Conversation) => void;
  onSwitchMode: (mode: Mode) => Promise<void>;
}) {
  const storage = `xingwei.active.${user.id}.astrology`;
  const modelReady = Boolean(config.astrology_model_ready ?? config.model_ready);
  const supportsImages = Boolean(config.astrology_supports_images ?? config.supports_images);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => initialConversationId === undefined ? localStorage.getItem(storage) : initialConversationId);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [delta, setDelta] = useState('');
  const [readingPreview, setReadingPreview] = useState<Partial<AstroReading> | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [manage, setManage] = useState(false);
  const [summary, setSummary] = useState<Profile | null>(null);
  const [rename, setRename] = useState<Conversation | null>(null);
  const [title, setTitle] = useState('');
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [chartId, setChartId] = useState('');
  const [planetId, setPlanetId] = useState('');
  const [revealId, setRevealId] = useState('');
  const composer = useRef<ComposerHandle>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const streamId = useRef<string | null>(null);
  const seenCharts = useRef(new Set<string>());
  const chartPanel = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [syncError, setSyncError] = useState('');
  const mounted = useRef(true);
  const currentId = useRef(activeId);
  currentId.current = activeId;
  const pendingAnswer = useRef<{ cid: string; before: Set<string> } | null>(null);
  const settling = !!detail && detail.conversation.id === activeId && detail.active;
  const working = busy || !!settling;

  useEffect(() => {
    if (initialConversationId === undefined) return;
    setActiveId(initialConversationId);
    if (initialConversationId) localStorage.setItem(storage, initialConversationId);
    else localStorage.removeItem(storage);
  }, [initialConversationId, storage]);
  useEffect(() => {
    if (!activeId || !settling || busy) return;
    let disposed = false;
    let timer: number | undefined;
    let request: AbortController | undefined;
    const sync = async () => {
      request = new AbortController();
      const timeout = window.setTimeout(() => request?.abort(), 15000);
      let again = true;
      try {
        const data = await api<ConversationDetail>(`/api/conversations/${activeId}`, { signal: request.signal });
        if (disposed) return;
        setDetail(data); setSyncError(''); again = data.active;
        data.charts.forEach(chart => seenCharts.current.add(chart.id));
        const pending = pendingAnswer.current;
        const answered = pending?.cid === activeId && data.messages.some(message => message.role === 'assistant' && !pending.before.has(message.id));
        if (answered) { setDelta(''); setReadingPreview(null); setError(''); }
      } catch { if (!disposed) setSyncError('同步暂时中断，正在重试'); }
      finally { window.clearTimeout(timeout); if (!disposed && again) timer = window.setTimeout(() => void sync(), 2000); }
    };
    timer = window.setTimeout(() => void sync(), 1000);
    return () => { disposed = true; window.clearTimeout(timer); request?.abort(); };
  }, [activeId, settling, busy]);

  const loadList = useCallback(async () => {
    setListLoading(true); setListError('');
    try {
      const list = await api<Conversation[]>('/api/conversations');
      setConversations(list);
      if (currentId.current && !list.some(conversation => conversation.id === currentId.current)) {
        localStorage.removeItem(storage);
        setActiveId(null);
      }
    }
    catch (reason) { setListError(errorMessage(reason)); }
    finally { setListLoading(false); }
  }, [storage]);
  const loadProfiles = useCallback(async () => {
    setProfileError('');
    try { setProfiles(await api<Profile[]>('/api/profiles')); }
    catch (reason) { setProfileError(errorMessage(reason)); }
  }, []);
  useEffect(() => { void loadList(); void loadProfiles(); }, [loadList, loadProfiles]);
  useEffect(() => {
    if (!activeId) { setDetail(null); setLoading(false); return; }
    localStorage.setItem(storage, activeId);
    if (detail?.conversation.id === activeId) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true); setError(''); setSyncError(''); setDetail(null); setReadingPreview(null); setChartId(''); setPlanetId(''); setRevealId('');
    api<ConversationDetail>(`/api/conversations/${activeId}`, { signal: abort.signal })
      .then(data => { setDetail(data); data.charts.forEach(chart => seenCharts.current.add(chart.id)); })
      .catch(reason => { if (!isAbortError(reason)) setError(errorMessage(reason)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [activeId, storage, detail?.conversation.id]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (follow.current && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; }, [detail?.messages, detail?.progress, delta, readingPreview]);

  const select = (id: string | null) => {
    if (lock.current) return;
    if (id) {
      const target = conversations.find(conversation => conversation.id === id);
      if (target && target.mode !== 'astrology') { setDrawer(false); onOpenConversation(target); return; }
    }
    pendingAnswer.current = null;
    setActiveId(id); setError(''); setDelta(''); setReadingPreview(null); setStopping(false); setDrawer(false); composer.current?.clear();
    if (!id) { localStorage.removeItem(storage); setDetail(null); setChartId(''); setRevealId(''); }
    follow.current = true;
  };
  const finishReveal = useCallback(() => setRevealId(''), []);
  const send = async (content: string, ids: string[], imageIds: string[], lengthMode: LengthMode) => {
    if (lock.current || settling || !modelReady) return;
    lock.current = true; setBusy(true); setError(''); setDelta(''); setReadingPreview(null); follow.current = true;
    let cid = activeId;
    const abort = new AbortController();
    controller.current = abort;
    const previousMessages = new Set(detail?.messages.map(message => message.id) || []);
    try {
      if (!cid) {
        const conversation = await api<Conversation>('/api/conversations', { method: 'POST', body: jsonBody({ mode: 'astrology' }), signal: abort.signal });
        cid = conversation.id; streamId.current = cid;
        setDetail({ conversation, messages: [], draws: [], charts: [], progress: [], active: true });
        setConversations(list => [conversation, ...list]); setActiveId(cid);
      }
      streamId.current = cid;
      pendingAnswer.current = { cid, before: previousMessages };
      setDetail(old => old ? { ...old, active: true } : old);
      await postSSE(`/api/conversations/${cid}/messages`, { content, profile_ids: ids, image_ids: imageIds, length_mode: lengthMode }, {
        signal: abort.signal,
        onEvent: (event, data) => {
          if (event === 'user_message') { const message = data as Message; setDetail(old => old ? { ...old, messages: upsert(old.messages, message) } : old); composer.current?.clear(); }
          if (event === 'progress') { const progress = data as Progress; setDetail(old => old ? { ...old, progress: upsert(old.progress, progress) } : old); }
          if (event === 'chart') { const chart = data as Chart; setDetail(old => old ? { ...old, charts: upsert(old.charts, chart) } : old); setChartId(chart.id); setError(''); if (!seenCharts.current.has(chart.id)) { seenCharts.current.add(chart.id); setRevealId(chart.id); } }
          if (event === 'reading_preview') { setReadingPreview((data as { reading: Partial<AstroReading> }).reading || {}); setDelta(''); setError(''); }
          if (event === 'reading_reset') { setReadingPreview(null); setDelta(''); }
          if (event === 'delta') { setDelta(text => text + (data as { text: string }).text); setError(''); }
          if (event === 'message') { const message = data as Message; setDetail(old => old ? { ...old, messages: upsert(old.messages, message) } : old); setDelta(''); setReadingPreview(null); setError(''); }
          if (event === 'error') { const failure = data as { message: string; attempt?: number; max_attempts?: number; recoverable?: boolean }; const message = publicText(failure.message || '本次探索未完成，请稍后继续'); const count = failure.attempt && failure.max_attempts ? `第 ${failure.attempt}/${failure.max_attempts} 次尝试` : ''; setError(failure.recoverable ? `${message}${count ? `（${count}未完成，正在继续）` : '（正在继续）'}` : `${count ? `${count}仍未成功，本次探索已停止。` : ''}${message}`); }
          if (event === 'done') setStopping(false);
        },
      });
    } catch (reason) { if (!isAbortError(reason)) setError(errorMessage(reason)); }
    finally {
      if (cid && mounted.current) {
        const refresh = new AbortController(); controller.current = refresh;
        const timeout = window.setTimeout(() => refresh.abort(), 15000);
        try {
          const data = await api<ConversationDetail>(`/api/conversations/${cid}`, { signal: refresh.signal });
          if (mounted.current) { setDetail(data); if (data.messages.some(message => message.role === 'assistant' && !previousMessages.has(message.id))) { setDelta(''); setReadingPreview(null); setError(''); } }
        } catch { /* 当前会话同步会继续收尾 */ }
        finally { window.clearTimeout(timeout); }
      }
      controller.current = null; streamId.current = null; lock.current = false;
      if (mounted.current) { setBusy(false); setStopping(false); void loadList(); }
    }
  };
  const stop = async () => {
    const cid = streamId.current || (settling ? activeId : null);
    if (!cid || stopping) return;
    setStopping(true);
    const localRequest = controller.current;
    try { await api(`/api/conversations/${cid}/stop`, { method: 'POST' }); localRequest?.abort(); }
    catch { if (mounted.current && currentId.current === cid) setError('停止请求未成功，请重试'); }
    finally { if (mounted.current && currentId.current === cid) setStopping(false); }
  };
  const mutateConversation = async (remove: boolean) => {
    const target = remove ? deleting : rename;
    if (!target) return;
    setSaving(true); setModalError('');
    try {
      const result = await api<Conversation>(`/api/conversations/${target.id}`, { method: remove ? 'DELETE' : 'PATCH', ...(remove ? {} : { body: jsonBody({ title: title.trim() }) }) });
      if (remove) { setConversations(list => list.filter(conversation => conversation.id !== target.id)); if (activeId === target.id) select(null); setDeleting(null); }
      else { setConversations(list => list.map(conversation => conversation.id === target.id ? result : conversation)); setDetail(old => old?.conversation.id === target.id ? { ...old, conversation: result } : old); setRename(null); }
    } catch (reason) { setModalError(errorMessage(reason)); }
    finally { setSaving(false); }
  };
  const charts = detail?.charts || [];
  const chart = charts.find(item => item.id === chartId) || charts[charts.length - 1];
  const selectPlanet = (id: string) => { const found = [chart, ...charts].find(item => item && [...item.planets, ...(item.outer_planets || [])].some(planet => planet.id === id)); if (!found) return; setChartId(found.id); setPlanetId(id); chartPanel.current?.scrollIntoView({ block: 'nearest' }); };
  const fillAction = (text: string) => { if (!working && !loading && modelReady) composer.current?.fill(text); };
  const timelineItems: ReactNode[] = [];
  if (detail) {
    const progress = [...detail.progress].sort((a, b) => timeValue(a.created_at) - timeValue(b.created_at));
    let cursor = 0;
    detail.messages.forEach(message => {
      const group: Progress[] = [];
      while (cursor < progress.length && timeValue(progress[cursor].created_at) <= timeValue(message.created_at)) group.push(progress[cursor++]);
      if (group.length) timelineItems.push(<ProgressLog key={`progress-${message.id}`} items={group} working={working} current={false} />);
      timelineItems.push(<article className={`astro-message astro-message--${message.role}`} key={message.id}><header><strong>{message.role === 'user' ? user.display_name : '秘域'}</strong><time>{formatDate(message.created_at, true)}</time></header>{message.images.length > 0 && <div className="message__images">{message.images.map(image => <a href={image.url} target="_blank" rel="noreferrer" key={image.id}><img src={image.url} alt={image.original_name} /></a>)}</div>}{message.reading ? <ReadingPanel reading={message.reading} profiles={profiles} onProfile={setSummary} onPlanet={selectPlanet} onAction={fillAction} actionDisabled={working || loading || !modelReady} /> : <div className="message__content"><RichText text={message.content} profiles={message.profiles || []} onProfile={setSummary} onPlanet={selectPlanet} /></div>}</article>);
    });
    if (cursor < progress.length) timelineItems.push(<ProgressLog key="progress-current" items={progress.slice(cursor)} working={working} current />);
  }
  const sidebar = <>
    <div className="sidebar__top"><Brand compact onClick={onHome} /><IconButton className="sidebar__mobile-close" label="关闭历史" onClick={() => setDrawer(false)}><Menu /></IconButton></div>
    <NewConversationButtons mode={mode} disabled={working} onNew={next => { if (working) return; if (next === mode) select(null); else { setDrawer(false); void onSwitchMode(next); } }} />
    <div className="sidebar__section-label"><span>往昔星轨</span><small>{conversations.length || ''}</small></div>
    <nav className="conversation-list" aria-label="历史对话">
      {listLoading && <LoadingBlock />}
      {!listLoading && listError && <div className="sidebar-error"><small>{listError}</small><Button variant="ghost" onClick={() => void loadList()}>重试</Button></div>}
      {!listLoading && !listError && !conversations.length && <small className="sidebar-empty">第一段星轨，从这里开始</small>}
      {conversations.map((conversation, index) => <ConversationCard
        key={conversation.id}
        conversation={conversation}
        index={index}
        selected={conversation.id === activeId}
        generating={working && conversation.id === activeId}
        disabled={busy || (working && conversation.mode !== mode)}
        actionsDisabled={working || saving}
        onOpen={() => select(conversation.id)}
        onRename={() => { setRename(conversation); setTitle(conversation.title || ''); setModalError(''); }}
        onDelete={() => { setDeleting(conversation); setModalError(''); }}
      />)}
    </nav>
    <footer className="sidebar__footer"><div className="user-chip"><span>{user.display_name.slice(0, 1)}</span><div><strong>{user.display_name}</strong><small>探索，始于此刻</small></div></div>{user.role === 'admin' && <IconButton label="进入秘域管理台" disabled={working} onClick={onAdmin}><ShieldCheck /></IconButton>}<IconButton label="退出登录" disabled={working} onClick={onLogout}><LogOut /></IconButton></footer>
  </>;

  return <main className="astro-shell">
    <aside className="sidebar">{sidebar}</aside>
    {drawer && <div className="sidebar-overlay" onClick={() => setDrawer(false)}><aside className="sidebar sidebar--mobile" onClick={event => event.stopPropagation()}>{sidebar}</aside></div>}
    <section className="astro-main">
      <header className="chat-header">
        <IconButton label="打开导航" className="mobile-menu" onClick={() => setDrawer(true)}><Menu /></IconButton>
        <div className="chat-header__title"><span className="eyebrow">Mysterious Realm · 星辰与自我</span><h1>{detail?.conversation.title || '循着星图，认识自己'}</h1></div>
        <ModeSwitcher mode={mode} onSwitch={onSwitchMode} disabled={busy || settling} />
        <Button type="button" className="chat-header__profiles" variant="ghost" aria-label="管理人物" aria-haspopup="dialog" onClick={() => setManage(true)}><UsersRound aria-hidden="true" /><span>人物</span></Button>
      </header>
      <div className="astro-workspace">
        <div className="chart-column" ref={chartPanel}>
          {charts.length > 1 && <label className="chart-switch">星盘<select value={chart?.id || ''} onChange={event => { setChartId(event.target.value); setPlanetId(''); setRevealId(''); }}>{charts.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          <ChartView chart={chart} selected={planetId} onSelect={setPlanetId} reveal={!!chart && chart.id === revealId} onRevealed={finishReveal} />
          {!charts.length && <div className="explore-actions">{[['认识自己', '请根据我的出生资料，解读我的性格与天赋。'], ['关系与相遇', '我想了解这两个人的关系模式与相处建议。'], ['当下与未来', '请结合我的星盘，看看近期值得关注的主题。']].map(([label, question]) => <button disabled={busy || !modelReady} key={label} onClick={() => composer.current?.fill(question)}><span>✧</span>{label}<span>↗</span></button>)}</div>}
        </div>
        <section className="dialogue-column">
          <div className="dialogue-timeline" ref={timeline} onScroll={event => { const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
            {loading ? <LoadingBlock /> : <>
              {!detail?.messages.length && <div className="dialogue-welcome"><MoonStar /><h2>从你的好奇开始</h2><small className="hint">用 + 或 @ 引用人物，让问题有迹可循。</small></div>}
              {timelineItems}
              {readingPreview && <ReadingPanel reading={readingPreview} profiles={profiles} onProfile={setSummary} onPlanet={selectPlanet} preview onAction={fillAction} actionDisabled={working || loading || !modelReady} />}
              {delta && !readingPreview && <article className="astro-message"><header><strong>秘域</strong><small>{working ? '正在回应' : '已保留的回应'}</small></header><div className="message__content"><div className="message__content-text">{delta}</div></div></article>}
              {settling && !busy ? <small className="hint" role="status">正在收尾并保存已发出的计算…{syncError && ` · ${syncError}`}</small> : busy && !delta && !readingPreview && <small className="hint" role="status">正在整理这次探索…</small>}
            </>}
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            {error && !detail && activeId && !busy && <Button variant="ghost" onClick={() => { const id = activeId; setActiveId(null); window.setTimeout(() => setActiveId(id), 0); }}>重新加载</Button>}
          </div>
          <div className="astro-composer-wrap">
            {profileError && <div className="hint">{profileError} <button onClick={() => void loadProfiles()}>重试</button></div>}
            {!modelReady && <small className="hint">当前模式尚未配置可用模型，请联系管理员。</small>}
            <ProfileComposer ref={composer} profiles={profiles} supportsImages={supportsImages} maxUploadMb={config.max_upload_mb} disabled={loading || !modelReady || (!!activeId && !detail)} busy={working} stopping={stopping} onSend={(text, ids, imageIds, lengthMode) => void send(text, ids, imageIds, lengthMode)} onStop={() => void stop()} onManage={() => setManage(true)} />
          </div>
        </section>
      </div>
    </section>
    {manage && <Profiles profiles={profiles} onChange={setProfiles} onClose={() => setManage(false)} />}
    {summary && <ProfileSummary profile={summary} onClose={() => setSummary(null)} />}
    {rename && <Modal title="重命名探索" onClose={() => setRename(null)} closeDisabled={saving}><form onSubmit={event => { event.preventDefault(); void mutateConversation(false); }}><Field label="标题"><input autoFocus maxLength={120} required value={title} onChange={event => setTitle(event.target.value)} /></Field>{modalError && <InlineNotice tone="error">{modalError}</InlineNotice>}<div className="modal__actions"><Button loading={saving} disabled={!title.trim()}>保存</Button></div></form></Modal>}
    {deleting && <Modal title={`删除「${deleting.title || '这段探索'}」？`} onClose={() => setDeleting(null)} closeDisabled={saving}><small className="hint">此探索中的消息与星盘会一并删除。</small>{modalError && <InlineNotice tone="error">{modalError}</InlineNotice>}<Button variant="danger" loading={saving} onClick={() => void mutateConversation(true)}>确认删除</Button></Modal>}
  </main>;
}
