import {
  LogOut,
  Check,
  ImagePlus,
  LoaderCircle,
  Menu,
  MessageCircleMore,
  MoonStar,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Stars,
  X,
} from 'lucide-react';
import { Fragment, type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, jsonBody, postSSE } from '../api';
import type { AppConfig, Conversation, ConversationDetail, Draw, ImageAsset, Message, Reading, User } from '../types';
import { cx, errorMessage, formatDate, isAbortError } from '../utils';
import { Ceremony } from './Ceremony';
import { DrawPanel } from './DrawPanel';
import { Brand, Button, Field, IconButton, InlineNotice, LoadingBlock, Modal } from './ui';
import { Reasoning } from './Reasoning';

interface Draft {
  text: string;
  images: ImageAsset[];
}

interface StreamState {
  active: boolean;
  kind: 'chat' | 'interpret';
  status: string;
  text: string;
  reasoning: string;
  reading?: Reading;
  error: string;
  drawId?: string;
}

interface ActiveRequest {
  controller: AbortController;
  kind: 'chat' | 'interpret';
}

type TimelineItem =
  | { key: string; type: 'message'; message: Message }
  | { key: string; type: 'draw'; draw: Draw };

const emptyDraft: Draft = { text: '', images: [] };
const suggestions = ['我该如何看待当下的关系？', '最近的事业方向有什么启示？', '为我梳理此刻的内心能量'];

function safeAssistantText(content: string, reading = false): string {
  if (/^\s*[\[{]/.test(content)) return reading ? '详细解读将整理在下方牌阵中。' : '星帷已整理好回应，请继续查看下方内容。';
  return content;
}

export function Chat({ user, config, onLogout, onAdmin }: {
  user: User;
  config: AppConfig;
  onLogout: () => void;
  onAdmin: () => void;
}) {
  const storageKey = `xingwei.active.${user.id}`;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(() => {
    const fresh = sessionStorage.getItem('xingwei.fresh-login') === user.id;
    if (fresh) {
      sessionStorage.removeItem('xingwei.fresh-login');
      localStorage.removeItem(storageKey);
      return null;
    }
    return localStorage.getItem(storageKey);
  });
  const [details, setDetails] = useState<Record<string, ConversationDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [streams, setStreams] = useState<Record<string, StreamState>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ceremony, setCeremony] = useState<Draw | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [creating, setCreating] = useState(false);
  const requests = useRef(new Map<string, ActiveRequest>());
  const activeIdRef = useRef(activeId);
  const detailRequest = useRef<AbortController | null>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastChat = useRef<Record<string, { content: string; imageIds: string[] }>>({});
  activeIdRef.current = activeId;

  const activeKey = activeId ?? 'new';
  const draft = drafts[activeKey] ?? emptyDraft;
  const currentDetail = activeId ? details[activeId] : undefined;
  const currentStream = activeId ? streams[activeId] : undefined;
  const currentUploading = uploading[activeKey] ?? 0;

  const refreshConversations = useCallback(async () => {
    try {
      const list = await api<Conversation[]>('/api/conversations');
      setConversations(list);
      setListError('');
      setDetails((previous) => {
        const next = { ...previous };
        list.forEach((conversation) => {
          if (next[conversation.id]) next[conversation.id] = { ...next[conversation.id], conversation };
        });
        return next;
      });
      if (activeIdRef.current && !list.some((item) => item.id === activeIdRef.current)) {
        localStorage.removeItem(storageKey);
        setActiveId(null);
      }
    } catch (reason) {
      setListError(errorMessage(reason));
    } finally {
      setListLoading(false);
    }
  }, [storageKey]);

  useEffect(() => { void refreshConversations(); }, [refreshConversations]);

  const loadConversation = useCallback(async (id: string, showLoading = true) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    if (showLoading) setDetailLoading(true);
    try {
      const detail = await api<ConversationDetail>(`/api/conversations/${id}`, { signal: controller.signal });
      setDetails((previous) => ({ ...previous, [id]: detail }));
      setDetailErrors((previous) => ({ ...previous, [id]: '' }));
    } catch (reason) {
      if (!isAbortError(reason)) setDetailErrors((previous) => ({ ...previous, [id]: errorMessage(reason) }));
    } finally {
      if (detailRequest.current === controller) {
        setDetailLoading(false);
        detailRequest.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!activeId || details[activeId]) {
      setDetailLoading(false);
      return;
    }
    void loadConversation(activeId);
  }, [activeId, details, loadConversation]);

  useEffect(() => () => {
    detailRequest.current?.abort();
    requests.current.forEach(({ controller }) => controller.abort());
  }, []);

  const selectConversation = (id: string | null) => {
    followOutput.current = true;
    setActiveId(id);
    setSidebarOpen(false);
    if (id) localStorage.setItem(storageKey, id);
    else localStorage.removeItem(storageKey);
  };

  const updateDraft = (key: string, update: Partial<Draft>) => {
    setDrafts((previous) => ({ ...previous, [key]: { ...(previous[key] ?? emptyDraft), ...update } }));
  };

  const mutateDetail = useCallback((id: string, mutate: (detail: ConversationDetail) => ConversationDetail) => {
    setDetails((previous) => {
      const detail = previous[id];
      if (!detail) return previous;
      return { ...previous, [id]: mutate(detail) };
    });
  }, []);

  const upsertMessage = useCallback((cid: string, message: Message, replaceId?: string) => {
    mutateDetail(cid, (detail) => {
      const messages = [...detail.messages];
      const index = messages.findIndex((item) => item.id === message.id || item.id === replaceId);
      if (index >= 0) messages[index] = message;
      else messages.push(message);
      return { ...detail, messages };
    });
  }, [mutateDetail]);

  const upsertDraw = useCallback((draw: Draw) => {
    mutateDetail(draw.conversation_id, (detail) => {
      const draws = [...detail.draws];
      const index = draws.findIndex((item) => item.id === draw.id);
      if (index >= 0) draws[index] = draw;
      else draws.push(draw);
      return { ...detail, draws };
    });
  }, [mutateDetail]);

  const setStream = (cid: string, update: Partial<StreamState>) => {
    setStreams((previous) => ({
      ...previous,
      [cid]: {
        ...(previous[cid] ?? { active: false, kind: 'chat', status: '', text: '', reasoning: '', error: '' }),
        ...update,
      },
    }));
  };

  const removeTemporary = (cid: string, temporaryId: string, keepContent: boolean) => {
    mutateDetail(cid, (detail) => ({
      ...detail,
      messages: detail.messages.filter((message) => message.id !== temporaryId || (keepContent && Boolean(message.content || message.reasoning))),
    }));
  };

  const runChatStream = async (cid: string, content: string, imageIds: string[], optimisticUserId?: string) => {
    if (requests.current.has(cid)) return;
    const controller = new AbortController();
    requests.current.set(cid, { controller, kind: 'chat' });
    lastChat.current[cid] = { content, imageIds };
    const temporaryId = `stream-assistant-${cid}`;
    followOutput.current = true;
    setStream(cid, { active: true, kind: 'chat', status: '正在连接星帷', text: '', reasoning: '', error: '', drawId: undefined });
    mutateDetail(cid, (detail) => ({
      ...detail,
      messages: [...detail.messages.filter((message) => message.id !== temporaryId), {
        id: temporaryId,
        role: 'assistant',
        content: '',
        images: [],
        created_at: new Date().toISOString(),
        kind: 'chat',
      }],
    }));
    try {
      await postSSE(`/api/conversations/${cid}/messages`, { content, image_ids: imageIds }, {
        signal: controller.signal,
        onEvent: (event, payload) => {
          if (event === 'user_message') {
            upsertMessage(cid, payload as Message, optimisticUserId);
          } else if (event === 'status') {
            setStream(cid, { status: (payload as { text: string }).text });
          } else if (event === 'preview' || event === 'reasoning') {
            const text = (payload as { text: string }).text;
            mutateDetail(cid, (detail) => ({
              ...detail,
              messages: detail.messages.map((message) => message.id === temporaryId
                ? event === 'preview' ? { ...message, content: text } : { ...message, reasoning: (message.reasoning ?? '') + text }
                : message),
            }));
            if (event === 'preview') setStream(cid, { text });
          } else if (event === 'delta') {
            const text = (payload as { text: string }).text;
            mutateDetail(cid, (detail) => ({
              ...detail,
              messages: detail.messages.map((message) => message.id === temporaryId ? { ...message, content: message.content + text } : message),
            }));
            setStreams((previous) => ({
              ...previous,
              [cid]: { ...previous[cid], text: `${previous[cid]?.text ?? ''}${text}` },
            }));
          } else if (event === 'message') {
            upsertMessage(cid, payload as Message, temporaryId);
            setStream(cid, { status: '' });
          } else if (event === 'draw') {
            upsertDraw(payload as Draw);
          } else if (event === 'error') {
            setStream(cid, { error: (payload as { message: string }).message, active: false });
          } else if (event === 'done') {
            setStream(cid, { active: false, status: '' });
          }
        },
      });
      setStream(cid, { active: false, status: '' });
      removeTemporary(cid, temporaryId, true);
      void refreshConversations();
    } catch (reason) {
      removeTemporary(cid, temporaryId, true);
      if (optimisticUserId) mutateDetail(cid, (detail) => ({ ...detail, messages: detail.messages.filter((message) => message.id !== optimisticUserId) }));
      if (isAbortError(reason)) setStream(cid, { active: false, status: '', error: '' });
      else setStream(cid, { active: false, status: '', error: errorMessage(reason) });
    } finally {
      requests.current.delete(cid);
    }
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!config.model_ready || creating || currentStream?.active || currentUploading > 0) return;
    const content = draft.text.trim();
    const images = draft.images;
    if (!content && images.length === 0) return;
    const sourceKey = activeKey;
    updateDraft(sourceKey, { text: '', images: [] });
    setDraftErrors((previous) => ({ ...previous, [sourceKey]: '' }));
    let cid = activeId;
    let optimisticUserId: string | undefined;
    try {
      if (!cid) {
        setCreating(true);
        const conversation = await api<Conversation>('/api/conversations', { method: 'POST', body: jsonBody({}) });
        cid = conversation.id;
        setConversations((previous) => [conversation, ...previous]);
        const blank: ConversationDetail = { conversation, messages: [], draws: [] };
        setDetails((previous) => ({ ...previous, [conversation.id]: blank }));
        if (activeIdRef.current === null) {
          setActiveId(cid);
          localStorage.setItem(storageKey, cid);
        }
      }
      setCreating(false);
      const targetId = cid;
      optimisticUserId = `optimistic-user-${Date.now()}`;
      const optimistic: Message = {
        id: optimisticUserId,
        role: 'user',
        content,
        images,
        created_at: new Date().toISOString(),
        kind: 'chat',
      };
      upsertMessage(targetId, optimistic);
      await runChatStream(targetId, content, images.map((image) => image.id), optimisticUserId);
    } catch (reason) {
      setDraftErrors((previous) => ({ ...previous, [sourceKey]: errorMessage(reason) }));
      updateDraft(sourceKey, { text: content, images });
    } finally {
      setCreating(false);
    }
  };

  const interpret = async (draw: Draw) => {
    const cid = draw.conversation_id;
    if (requests.current.has(cid)) return;
    const controller = new AbortController();
    requests.current.set(cid, { controller, kind: 'interpret' });
    followOutput.current = true;
    setStream(cid, { active: true, kind: 'interpret', status: '正在聆听牌面', text: '', reasoning: '', reading: undefined, error: '', drawId: draw.id });
    try {
      await postSSE(`/api/conversations/${cid}/draws/${draw.id}/interpret`, {}, {
        signal: controller.signal,
        onEvent: (event, payload) => {
          if (event === 'status') setStream(cid, { status: (payload as { text: string }).text });
          if (event === 'reading_preview') setStream(cid, { reading: payload as Reading });
          if (event === 'reasoning') {
            const text = (payload as { text: string }).text;
            setStreams((previous) => ({ ...previous, [cid]: { ...previous[cid], reasoning: (previous[cid]?.reasoning ?? '') + text } }));
          }
          if (event === 'delta') {
            const text = (payload as { text: string }).text;
            setStreams((previous) => ({
              ...previous,
              [cid]: { ...previous[cid], text: `${previous[cid]?.text ?? ''}${text}` },
            }));
          }
          if (event === 'message') upsertMessage(cid, payload as Message);
          if (event === 'draw') upsertDraw(payload as Draw);
          if (event === 'error') setStream(cid, { active: false, error: (payload as { message: string }).message });
          if (event === 'done') setStream(cid, { active: false, status: '' });
        },
      });
      setStream(cid, { active: false, status: '' });
      void refreshConversations();
    } catch (reason) {
      if (isAbortError(reason)) setStream(cid, { active: false, status: '已停止生成，可继续解读', error: '' });
      else setStream(cid, { active: false, status: '', error: errorMessage(reason) });
    } finally {
      requests.current.delete(cid);
    }
  };

  const cancelStream = () => {
    if (!activeId) return;
    requests.current.get(activeId)?.controller.abort();
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || !config.supports_images) return;
    const key = activeKey;
    const existing = drafts[key]?.images ?? [];
    const available = Math.max(0, 4 - existing.length);
    const selected = Array.from(files).slice(0, available);
    if (files.length > available) setDraftErrors((previous) => ({ ...previous, [key]: '一条消息最多上传 4 张图片' }));
    const maxBytes = config.max_upload_mb * 1024 * 1024;
    const valid = selected.filter((file) => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        setDraftErrors((previous) => ({ ...previous, [key]: '仅支持 PNG、JPEG 或 WebP 图片' }));
        return false;
      }
      if (file.size > maxBytes) {
        setDraftErrors((previous) => ({ ...previous, [key]: `单张图片不能超过 ${config.max_upload_mb}MB` }));
        return false;
      }
      return true;
    });
    if (!valid.length) return;
    setDraftErrors((previous) => ({ ...previous, [key]: '' }));
    setUploading((previous) => ({ ...previous, [key]: (previous[key] ?? 0) + valid.length }));
    for (const file of valid) {
      try {
        const body = new FormData();
        body.append('file', file);
        const image = await api<ImageAsset>('/api/uploads', { method: 'POST', body });
        setDrafts((previous) => ({
          ...previous,
          [key]: { ...(previous[key] ?? emptyDraft), images: [...(previous[key]?.images ?? []), image] },
        }));
      } catch (reason) {
        setDraftErrors((previous) => ({ ...previous, [key]: `${file.name}：${errorMessage(reason)}` }));
      } finally {
        setUploading((previous) => ({ ...previous, [key]: Math.max(0, (previous[key] ?? 1) - 1) }));
      }
    }
  };

  const saveTitle = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeId || !renameValue.trim()) return;
    setRenameSaving(true);
    setRenameError('');
    try {
      const conversation = await api<Conversation>(`/api/conversations/${activeId}`, { method: 'PATCH', body: jsonBody({ title: renameValue.trim() }) });
      setConversations((previous) => previous.map((item) => item.id === conversation.id ? conversation : item));
      mutateDetail(activeId, (detail) => ({ ...detail, conversation }));
      setRenaming(false);
    } catch (reason) {
      setRenameError(errorMessage(reason));
    } finally {
      setRenameSaving(false);
    }
  };

  useEffect(() => {
    const container = scrollContainer.current;
    if (container && followOutput.current && !document.querySelector('[aria-modal="true"]')) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeId, currentDetail?.messages.length, currentDetail?.draws.length, currentStream?.text, currentStream?.reading]);

  const timeline: TimelineItem[] = [];
  const linkedDraws = new Set<string>();
  currentDetail?.messages.forEach((message) => {
    const hasReading = message.kind === 'reading' && currentDetail.draws.some((draw) => draw.id === message.draw_id && draw.reading);
    if (!hasReading) timeline.push({ key: `message-${message.id}`, type: 'message', message });
    if (message.draw_id) {
      const draw = currentDetail.draws.find((item) => item.id === message.draw_id);
      if (draw && !linkedDraws.has(draw.id)) {
        linkedDraws.add(draw.id);
        timeline.push({ key: `draw-${draw.id}`, type: 'draw', draw });
      }
    }
  });
  currentDetail?.draws.forEach((draw) => {
    if (!linkedDraws.has(draw.id)) timeline.push({ key: `draw-${draw.id}`, type: 'draw', draw });
  });

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const sidebar = (
    <>
      <div className="sidebar__top"><Brand compact /><IconButton className="sidebar__mobile-close" label="关闭历史" onClick={() => setSidebarOpen(false)}><X /></IconButton></div>
      <Button className="new-chat" variant="secondary" onClick={() => selectConversation(null)}><Plus />新的对话</Button>
      <div className="sidebar__section-label"><span>往昔星轨</span><small>{conversations.length || ''}</small></div>
      <div className="conversation-list">
        {listLoading && <LoadingBlock />}
        {!listLoading && listError && <div className="sidebar-error"><span>{listError}</span><Button variant="ghost" onClick={() => { setListLoading(true); void refreshConversations(); }}>重试</Button></div>}
        {!listLoading && !listError && conversations.length === 0 && <p className="sidebar-empty">第一段星轨，正等待落笔。</p>}
        {conversations.map((conversation, index) => (
          <button
            key={conversation.id}
            className={cx('conversation-item', activeId === conversation.id && 'is-active')}
            onClick={() => selectConversation(conversation.id)}
            style={{ '--item-index': Math.min(index, 8) } as React.CSSProperties}
          >
            <MessageCircleMore />
            <span><strong>{conversation.title || '未命名对话'}</strong><small>{formatDate(conversation.updated_at, true)}</small></span>
            {streams[conversation.id]?.active && <i className="conversation-item__live" aria-label="正在回应" />}
            {activeId === conversation.id && <Check className="conversation-item__check" />}
          </button>
        ))}
      </div>
      <div className="sidebar__footer">
        <div className="user-chip"><span>{user.display_name.slice(0, 1)}</span><div><strong>{user.display_name}</strong><small>@{user.username}</small></div></div>
        {user.role === 'admin' && <IconButton label="进入星帷管理台" onClick={onAdmin}><ShieldCheck /></IconButton>}
        <IconButton label="退出登录" onClick={onLogout}><LogOut /></IconButton>
      </div>
    </>
  );

  return (
    <main className="chat-shell">
      <aside className="sidebar">{sidebar}</aside>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}><aside className="sidebar sidebar--mobile" onClick={(event) => event.stopPropagation()}>{sidebar}</aside></div>}
      <section className="chat-main">
        <header className="chat-header">
          <IconButton className="chat-header__menu" label="打开历史对话" onClick={() => setSidebarOpen(true)}><Menu /></IconButton>
          <div className="chat-header__title"><span className="eyebrow">{activeId ? '星轨回溯' : '此刻 · 新的篇章'}</span><h1>{currentDetail?.conversation.title || '与星帷对话'}</h1></div>
          <div className="chat-header__actions">
            {activeId && <IconButton label="重命名对话" onClick={() => { setRenameValue(currentDetail?.conversation.title ?? ''); setRenameError(''); setRenaming(true); }}><Pencil /></IconButton>}
            <span className="presence"><i />星帷在此</span>
          </div>
        </header>
        <div className="chat-scroll" ref={scrollContainer} onScroll={(event) => {
          const element = event.currentTarget;
          followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        }}>
          <div className="chat-timeline">
            {!activeId && (
              <section className="welcome">
                <div className="welcome__sigil"><MoonStar /><span /></div>
                <span className="eyebrow">THE STARS ARE LISTENING</span>
                <h2>今夜，什么萦绕在你心间？</h2>
                <p>不必组织完美的语言，从这里开始就好。</p>
                <div className="welcome__suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => updateDraft('new', { text: suggestion })}><Sparkles />{suggestion}</button>)}</div>
              </section>
            )}
            {activeId && detailLoading && !currentDetail && <LoadingBlock className="chat-loading" />}
            {activeId && detailErrors[activeId] && !currentDetail && <div className="detail-error"><InlineNotice tone="error">{detailErrors[activeId]}</InlineNotice><Button variant="secondary" onClick={() => void loadConversation(activeId)}>重新加载</Button></div>}
            {activeId && currentDetail && timeline.length === 0 && <div className="continuation"><Stars /><h2>让这段星轨继续</h2><p>写下你的问题，星帷会在这里回应。</p></div>}
            {timeline.map((item) => item.type === 'message' ? (
              <article className={cx('message', `message--${item.message.role}`)} key={item.key}>
                <div className="message__avatar">{item.message.role === 'assistant' ? <MoonStar /> : user.display_name.slice(0, 1)}</div>
                <div className="message__body">
                  <div className="message__meta"><strong>{item.message.role === 'assistant' ? '星帷' : user.display_name}</strong><time>{formatDate(item.message.created_at, true)}</time>{item.message.id.startsWith('stream-') && currentStream?.active && <span>{currentStream.status || '回应中'}</span>}</div>
                  {item.message.images.length > 0 && <div className="message__images">{item.message.images.map((image) => <a href={image.url} target="_blank" rel="noreferrer" key={image.id}><img src={image.url} alt={image.original_name} /></a>)}</div>}
                  {item.message.role === 'assistant' && <Reasoning text={item.message.reasoning} active={item.message.id.startsWith('stream-') && currentStream?.active} />}
                  <div className="message__content">{item.message.content ? (item.message.role === 'assistant' ? safeAssistantText(item.message.content, item.message.kind === 'reading') : item.message.content) : (item.message.id.startsWith('stream-') ? <span className="thinking"><i /><i /><i /></span> : null)}</div>
                </div>
              </article>
            ) : (
              <Fragment key={item.key}>
              <Reasoning
                text={currentStream?.drawId === item.draw.id && !item.draw.reading ? currentStream.reasoning : currentDetail?.messages.find((message) => message.draw_id === item.draw.id && message.kind === 'reading')?.reasoning}
                active={Boolean(currentStream?.active && currentStream.drawId === item.draw.id && !item.draw.reading)}
              />
              <DrawPanel
                key={item.key}
                draw={item.draw}
                onOpenCeremony={setCeremony}
                onInterpret={(draw) => void interpret(draw)}
                interpreting={Boolean(currentStream?.active && currentStream.drawId === item.draw.id)}
                streamReading={currentStream?.drawId === item.draw.id ? currentStream.reading : undefined}
                streamStatus={currentStream?.drawId === item.draw.id ? currentStream.status : ''}
                error={currentStream?.drawId === item.draw.id ? currentStream.error : ''}
              />
              </Fragment>
            ))}
            {currentStream?.error && currentStream.kind === 'chat' && (
              <div className="stream-error-row" role="alert"><span>{currentStream.error}</span><Button variant="ghost" onClick={() => { if (activeId && lastChat.current[activeId]) { const last = lastChat.current[activeId]; void runChatStream(activeId, last.content, last.imageIds); } }}>重新发送</Button><Button variant="ghost" onClick={() => activeId && void loadConversation(activeId, false)}>同步对话</Button></div>
            )}
          </div>
        </div>
        <footer className="composer-wrap">
          {!config.model_ready && <div className="model-hint"><MoonStar />尚未配置默认模型，请联系管理员点亮星帷。</div>}
          {draftErrors[activeKey] && <div className="composer-error" role="alert">{draftErrors[activeKey]}<IconButton label="关闭错误" onClick={() => setDraftErrors((previous) => ({ ...previous, [activeKey]: '' }))}><X /></IconButton></div>}
          {(draft.images.length > 0 || currentUploading > 0) && <div className="upload-previews">{draft.images.map((image) => <div key={image.id}><img src={image.url} alt={image.original_name} /><IconButton label={`移除 ${image.original_name}`} onClick={() => updateDraft(activeKey, { images: draft.images.filter((item) => item.id !== image.id) })}><X /></IconButton></div>)}{currentUploading > 0 && <span className="uploading-tile"><LoaderCircle className="spin" />{currentUploading} 张上传中</span>}</div>}
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              value={draft.text}
              onChange={(event) => updateDraft(activeKey, { text: event.target.value })}
              onKeyDown={onComposerKeyDown}
              placeholder="把心事告诉星帷…"
              aria-label="对话内容"
              rows={1}
              maxLength={12000}
            />
            <input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ''; }} />
            <div className="composer__tools">
              <IconButton type="button" label={config.supports_images ? `上传图片，单张不超过 ${config.max_upload_mb}MB` : '当前模型不支持图片'} disabled={!config.supports_images || draft.images.length >= 4 || currentUploading > 0} onClick={() => fileInput.current?.click()}><ImagePlus /></IconButton>
              <span className="composer__hint">Enter 发送 · Shift + Enter 换行</span>
            </div>
            {currentStream?.active ? <IconButton type="button" className="composer__send composer__send--stop" label="停止等待" onClick={cancelStream}><Square /></IconButton> : <IconButton className="composer__send" label="发送消息" type="submit" disabled={creating || currentUploading > 0 || !config.model_ready || (!draft.text.trim() && !draft.images.length)}>{creating ? <LoaderCircle className="spin" /> : <Send />}</IconButton>}
          </form>
        </footer>
      </section>
      {ceremony && <Ceremony key={ceremony.id} draw={ceremony} conversationId={ceremony.conversation_id} onRevealed={upsertDraw} onFinish={(draw) => { upsertDraw(draw); setCeremony(null); }} onClose={() => setCeremony(null)} />}
      {renaming && activeId && (
        <Modal title="为这段星轨命名" onClose={() => setRenaming(false)} closeDisabled={renameSaving} className="modal--small">
          <form onSubmit={saveTitle}>
            <Field label="对话名称" error={renameError}><input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required maxLength={80} placeholder="输入新名称" /></Field>
            <div className="modal__actions"><Button type="button" variant="ghost" onClick={() => setRenaming(false)}>取消</Button><Button type="submit" loading={renameSaving}>保存名称</Button></div>
          </form>
        </Modal>
      )}
    </main>
  );
}
