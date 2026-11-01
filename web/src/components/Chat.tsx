import {
  LogOut,
  ImagePlus,
  LoaderCircle,
  Menu,
  MoonStar,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Stars,
  X,
} from 'lucide-react';
import { Fragment, type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, jsonBody, postSSE } from '../api';
import type { AppConfig, Conversation, ConversationDetail, Draw, ImageAsset, LengthMode, Message, Mode, TarotReading, User } from '../types';
import { cx, errorMessage, formatDate, isAbortError } from '../utils';
import { Ceremony } from './Ceremony';
import { DrawPanel } from './DrawPanel';
import { Brand, Button, ConfirmDialog, Field, IconButton, InlineNotice, LoadingBlock, Modal } from './ui';
import { ModeSwitcher } from './ModeSwitcher';
import { ConversationCard } from './ConversationCard';
import { Reasoning } from './Reasoning';
import { NewConversationButtons } from './NewConversationButtons';
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
  reading?: TarotReading;
  error: string;
  drawId?: string;
  lengthMode?: LengthMode;
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
  if (/^\s*[\[{]/.test(content)) return reading ? '详细解读将整理在下方牌阵中。' : '回应已整理，请继续查看下方内容。';
  return content;
}

export function Chat({ user, config, onLogout, onAdmin, mode, initialConversationId, onOpenConversation, onSwitchMode }: {
  user: User;
  config: AppConfig;
  onLogout: () => void;
  onAdmin: () => void;
  mode: Mode;
  initialConversationId?: string | null;
  onOpenConversation: (conversation: Conversation) => void;
  onSwitchMode: (mode: Mode) => Promise<void>;
}) {
  const storageKey = `xingwei.active.${user.id}.${mode}`;
  const modelReady = mode === 'tarot' ? Boolean(config.tarot_model_ready ?? config.model_ready) : Boolean(config.astrology_model_ready ?? config.model_ready);
  const supportsImages = mode === 'tarot' ? Boolean(config.tarot_supports_images ?? config.supports_images) : Boolean(config.astrology_supports_images ?? config.supports_images);
  const lengthStorageKey = `xingwei.length.${user.id}.${mode}`;
  const [lengthMode, setLengthMode] = useState<LengthMode>(() => localStorage.getItem(lengthStorageKey) === 'detailed' ? 'detailed' : 'concise');
  const selectLengthMode = (mode: LengthMode) => {
    setLengthMode(mode);
    localStorage.setItem(lengthStorageKey, mode);
  };
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(() => initialConversationId === undefined ? localStorage.getItem(storageKey) : initialConversationId);
  const [details, setDetails] = useState<Record<string, ConversationDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [streams, setStreams] = useState<Record<string, StreamState>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ceremony, setCeremony] = useState<Draw | null>(null);
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  useEffect(() => {
    if (initialConversationId === undefined) return;
    setActiveId(initialConversationId);
    if (initialConversationId) localStorage.setItem(storageKey, initialConversationId);
    else localStorage.removeItem(storageKey);
  }, [initialConversationId, storageKey]);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const requests = useRef(new Map<string, ActiveRequest>());
  const activeIdRef = useRef(activeId);
  const deletedConversationIds = useRef(new Set<string>());
  const pendingDeleteIds = useRef(new Set<string>());
  const pendingDeleteSnapshots = useRef(new Map<string, Conversation>());
  const detailRequest = useRef<AbortController | null>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastChat = useRef<Record<string, { content: string; imageIds: string[]; lengthMode: LengthMode }>>({});
  activeIdRef.current = activeId;

  const activeKey = activeId ?? 'new';
  const draft = drafts[activeKey] ?? emptyDraft;
  const currentDetail = activeId ? details[activeId] : undefined;
  const currentStream = activeId ? streams[activeId] : undefined;
  const currentUploading = uploading[activeKey] ?? 0;
  const anyGenerating = creating || requests.current.size > 0 || Object.values(streams).some((stream) => stream.active);

  const refreshConversations = useCallback(async () => {
    try {
      const list = await api<Conversation[]>('/api/conversations');
      const visible = list.filter((conversation) => !deletedConversationIds.current.has(conversation.id));
      pendingDeleteIds.current.forEach((id) => {
        if (!visible.some((conversation) => conversation.id === id)) {
          const snapshot = pendingDeleteSnapshots.current.get(id);
          if (snapshot) visible.push(snapshot);
        }
      });
      setConversations(visible);
      setListError('');
      setDetails((previous) => {
        const next = { ...previous };
        visible.forEach((conversation) => {
          if (next[conversation.id]) next[conversation.id] = { ...next[conversation.id], conversation };
        });
        return next;
      });
      if (activeIdRef.current && !pendingDeleteIds.current.has(activeIdRef.current) && !visible.some((item) => item.id === activeIdRef.current)) {
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
      if (deletedConversationIds.current.has(id) || pendingDeleteIds.current.has(id)) return;
      setDetails((previous) => ({ ...previous, [id]: detail }));
      setDetailErrors((previous) => ({ ...previous, [id]: '' }));
    } catch (reason) {
      if (!isAbortError(reason) && !deletedConversationIds.current.has(id) && !pendingDeleteIds.current.has(id)) setDetailErrors((previous) => ({ ...previous, [id]: errorMessage(reason) }));
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
    if (id) {
      const target = conversations.find((conversation) => conversation.id === id);
      if (target && target.mode !== mode) {
        setSidebarOpen(false);
        onOpenConversation(target);
        return;
      }
    }
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
    if (deletedConversationIds.current.has(id) || pendingDeleteIds.current.has(id)) return;
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
    if (deletedConversationIds.current.has(cid) || pendingDeleteIds.current.has(cid)) return;
    setStreams((previous) => ({
      ...previous,
      [cid]: {
        ...(previous[cid] ?? { active: false, kind: 'chat', status: '', text: '', reasoning: '', error: '' }),
        ...update,
      },
    }));
  };
  const appendStream = (cid: string, field: 'text' | 'reasoning', text: string) => {
    if (deletedConversationIds.current.has(cid) || pendingDeleteIds.current.has(cid)) return;
    setStreams((previous) => ({
      ...previous,
      [cid]: { ...previous[cid], [field]: `${previous[cid]?.[field] ?? ''}${text}` },
    }));
  };
  const removeTemporary = (cid: string, temporaryId: string, keepContent: boolean) => {
    mutateDetail(cid, (detail) => ({
      ...detail,
      messages: detail.messages.filter((message) => message.id !== temporaryId || (keepContent && Boolean(message.content || message.reasoning))),
    }));
  };

  const runChatStream = async (cid: string, content: string, imageIds: string[], requestLengthMode: LengthMode, optimisticUserId?: string) => {
    if (requests.current.has(cid)) return;
    const controller = new AbortController();
    requests.current.set(cid, { controller, kind: 'chat' });
    lastChat.current[cid] = { content, imageIds, lengthMode: requestLengthMode };
    const temporaryId = `stream-assistant-${cid}`;
    followOutput.current = true;
    setStream(cid, { active: true, kind: 'chat', status: '正在准备回应', text: '', reasoning: '', error: '', drawId: undefined });
    mutateDetail(cid, (detail) => ({
      ...detail,
      messages: [...detail.messages.filter((message) => message.id !== temporaryId), {
        id: temporaryId,
        role: 'assistant',
        content: '',
        images: [],
        created_at: new Date().toISOString(),
        kind: 'chat',
        profiles: [],
      }],
    }));
    try {
      await postSSE(`/api/conversations/${cid}/messages`, { content, image_ids: imageIds, length_mode: requestLengthMode }, {
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
            appendStream(cid, 'text', text);
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
    if (!modelReady || creating || currentStream?.active || currentUploading > 0) return;
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
        const conversation = await api<Conversation>('/api/conversations', { method: 'POST', body: jsonBody({ mode }) });
        cid = conversation.id;
        setConversations((previous) => [conversation, ...previous]);
        const blank: ConversationDetail = { conversation, messages: [], draws: [], charts: [], progress: [], active: false };
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
        profiles: [],
      };
      upsertMessage(targetId, optimistic);
      await runChatStream(targetId, content, images.map((image) => image.id), lengthMode, optimisticUserId);
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
    const previous = streams[cid];
    const requestLengthMode = previous?.drawId === draw.id && previous.error ? previous.lengthMode ?? lengthMode : lengthMode;
    const controller = new AbortController();
    requests.current.set(cid, { controller, kind: 'interpret' });
    followOutput.current = true;
    setStream(cid, { active: true, kind: 'interpret', status: '正在聆听牌面', text: '', reasoning: '', reading: undefined, error: '', drawId: draw.id, lengthMode: requestLengthMode });
    try {
      await postSSE(`/api/conversations/${cid}/draws/${draw.id}/interpret`, { length_mode: requestLengthMode }, {
        signal: controller.signal,
        onEvent: (event, payload) => {
          if (event === 'status') setStream(cid, { status: (payload as { text: string }).text });
          if (event === 'reading_preview') setStream(cid, { reading: payload as TarotReading });
          if (event === 'reasoning') {
            const text = (payload as { text: string }).text;
            appendStream(cid, 'reasoning', text);
          }
          if (event === 'delta') {
            const text = (payload as { text: string }).text;
            appendStream(cid, 'text', text);
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
    if (!files || !supportsImages) return;
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
      if (deletedConversationIds.current.has(key)) break;
      try {
        const body = new FormData();
        body.append('file', file);
        const image = await api<ImageAsset>('/api/uploads', { method: 'POST', body });
        if (deletedConversationIds.current.has(key)) break;
        setDrafts((previous) => ({
          ...previous,
          [key]: { ...(previous[key] ?? emptyDraft), images: [...(previous[key]?.images ?? []), image] },
        }));
      } catch (reason) {
        if (!deletedConversationIds.current.has(key)) setDraftErrors((previous) => ({ ...previous, [key]: `${file.name}：${errorMessage(reason)}` }));
      } finally {
        if (!deletedConversationIds.current.has(key)) setUploading((previous) => ({ ...previous, [key]: Math.max(0, (previous[key] ?? 1) - 1) }));
      }
    }
  };

  const saveTitle = async (event: FormEvent) => {
    event.preventDefault();
    if (!renaming || !renameValue.trim()) return;
    setRenameSaving(true);
    setRenameError('');
    try {
      const conversation = await api<Conversation>(`/api/conversations/${renaming.id}`, { method: 'PATCH', body: jsonBody({ title: renameValue.trim() }) });
      setConversations((previous) => previous.map((item) => item.id === conversation.id ? conversation : item));
      mutateDetail(renaming.id, (detail) => ({ ...detail, conversation }));
      setRenaming(null);
    } catch (reason) {
      setRenameError(errorMessage(reason));
    } finally {
      setRenameSaving(false);
    }
  };

  const clearConversationState = (id: string) => {
    setDetails((previous) => { const next = { ...previous }; delete next[id]; return next; });
    setDrafts((previous) => { const next = { ...previous }; delete next[id]; return next; });
    setUploading((previous) => { const next = { ...previous }; delete next[id]; return next; });
    setDraftErrors((previous) => { const next = { ...previous }; delete next[id]; return next; });
    setDetailErrors((previous) => { const next = { ...previous }; delete next[id]; return next; });
    setStreams((previous) => { const next = { ...previous }; delete next[id]; return next; });
    requests.current.get(id)?.controller.abort();
    requests.current.delete(id);
    delete lastChat.current[id];
    setCeremony((current) => current?.conversation_id === id ? null : current);
    setRenaming((current) => current?.id === id ? null : current);
  };

  const isConversationGenerating = (id: string) => Boolean(streams[id]?.active || requests.current.has(id));

  const openDelete = (conversation: Conversation) => {
    if (isConversationGenerating(conversation.id) || deleteSaving) return;
    setDeleteTarget(conversation);
  };

  const removeConversation = async () => {
    const target = deleteTarget;
    if (!target || deleteSaving || isConversationGenerating(target.id)) return;
    const id = target.id;
    pendingDeleteIds.current.add(id);
    pendingDeleteSnapshots.current.set(id, target);
    setDeleteSaving(true);
    setDeleteErrors((previous) => ({ ...previous, [id]: '' }));
    try {
      await api<{ ok: true }>(`/api/conversations/${id}`, { method: 'DELETE' });
      deletedConversationIds.current.add(id);
      pendingDeleteIds.current.delete(id);
      pendingDeleteSnapshots.current.delete(id);
      setConversations((previous) => previous.filter((conversation) => conversation.id !== id));
      clearConversationState(id);
      setDeleteErrors((previous) => { const next = { ...previous }; delete next[id]; return next; });
      if (activeIdRef.current === id) {
        setRenameError('');
        detailRequest.current?.abort();
        selectConversation(null);
      }
      setDeleteTarget(null);
    } catch (reason) {
      pendingDeleteIds.current.delete(id);
      pendingDeleteSnapshots.current.delete(id);
      setConversations((previous) => previous.some((conversation) => conversation.id === id) ? previous : [target, ...previous]);
      setDeleteErrors((previous) => ({ ...previous, [id]: errorMessage(reason) }));
      if (activeIdRef.current === id && !details[id]) void loadConversation(id);
      setDeleteTarget(null);
    } finally {
      setDeleteSaving(false);
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
      <NewConversationButtons mode={mode} switchingDisabled={anyGenerating} onNew={next => { if (next === mode) selectConversation(null); else if (!anyGenerating) { setSidebarOpen(false); void onSwitchMode(next); } }} />
      <div className="sidebar__section-label"><span>往昔星轨</span><small>{conversations.length || ''}</small></div>
      <div className="conversation-list">
        {listLoading && <LoadingBlock />}
        {!listLoading && listError && <div className="sidebar-error"><span>{listError}</span><Button variant="ghost" onClick={() => { setListLoading(true); void refreshConversations(); }}>重试</Button></div>}
        {!listLoading && !listError && conversations.length === 0 && <p className="sidebar-empty">第一段星轨，正等待落笔。</p>}
        {conversations.map((conversation, index) => <ConversationCard
          key={conversation.id}
          conversation={conversation}
          index={index}
          selected={activeId === conversation.id}
          generating={isConversationGenerating(conversation.id)}
          disabled={anyGenerating && conversation.mode !== mode}
          actionsDisabled={deleteSaving || renameSaving}
          error={deleteErrors[conversation.id]}
          onOpen={() => selectConversation(conversation.id)}
          onRename={() => { setRenaming(conversation); setRenameValue(conversation.title); setRenameError(''); }}
          onDelete={() => openDelete(conversation)}
        />)}
      </div>
      <div className="sidebar__footer">
        <div className="user-chip"><span>{user.display_name.slice(0, 1)}</span><div><strong>{user.display_name}</strong><small>@{user.username}</small></div></div>
        {user.role === 'admin' && <IconButton label="进入秘域管理台" disabled={anyGenerating} onClick={onAdmin}><ShieldCheck /></IconButton>}
        <IconButton label="退出登录" disabled={anyGenerating} onClick={onLogout}><LogOut /></IconButton>
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
          <div className="chat-header__title"><span className="eyebrow">{activeId ? '塔罗 · 回望与发现' : '塔罗 · 此刻起牌'}</span><h1>{currentDetail?.conversation.title || '在牌面之间，遇见自己'}</h1></div>
          <ModeSwitcher mode={mode} onSwitch={onSwitchMode} disabled={anyGenerating} />
          <div className="chat-header__actions">
            <span className="presence"><i />静候你的提问</span>
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
                <h2>此刻，什么萦绕在你心间？</h2>
                <p>不必组织完美的语言，从这里开始就好。</p>
                <div className="welcome__suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => updateDraft('new', { text: suggestion })}><Sparkles />{suggestion}</button>)}</div>
              </section>
            )}
            {activeId && detailLoading && !currentDetail && <LoadingBlock className="chat-loading" />}
            {activeId && detailErrors[activeId] && !currentDetail && <div className="detail-error"><InlineNotice tone="error">{detailErrors[activeId]}</InlineNotice><Button variant="secondary" onClick={() => void loadConversation(activeId)}>重新加载</Button></div>}
            {activeId && currentDetail && timeline.length === 0 && <div className="continuation"><Stars /><h2>让这段探索继续</h2><p>写下你的问题，让牌面带来新的视角。</p></div>}
            {timeline.map((item) => item.type === 'message' ? (
              <article className={cx('message', `message--${item.message.role}`)} key={item.key}>
                <div className="message__avatar">{item.message.role === 'assistant' ? <MoonStar /> : user.display_name.slice(0, 1)}</div>
                <div className="message__body">
                  <div className="message__meta"><strong>{item.message.role === 'assistant' ? '秘域' : user.display_name}</strong><time>{formatDate(item.message.created_at, true)}</time>{item.message.id.startsWith('stream-') && currentStream?.active && <span>{currentStream.status || '回应中'}</span>}</div>
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
              <div className="stream-error-row" role="alert"><span>{currentStream.error}</span><Button variant="ghost" onClick={() => { if (activeId && lastChat.current[activeId]) { const last = lastChat.current[activeId]; void runChatStream(activeId, last.content, last.imageIds, last.lengthMode); } }}>重新发送</Button><Button variant="ghost" onClick={() => activeId && void loadConversation(activeId, false)}>同步对话</Button></div>
            )}
          </div>
        </div>
        <footer className="composer-wrap">
          {!modelReady && <div className="model-hint"><MoonStar />当前模式尚未配置可用模型，请联系管理员。</div>}
          {draftErrors[activeKey] && <div className="composer-error" role="alert">{draftErrors[activeKey]}<IconButton label="关闭错误" onClick={() => setDraftErrors((previous) => ({ ...previous, [activeKey]: '' }))}><X /></IconButton></div>}
          {(draft.images.length > 0 || currentUploading > 0) && <div className="upload-previews">{draft.images.map((image) => <div key={image.id}><img src={image.url} alt={image.original_name} /><IconButton label={`移除 ${image.original_name}`} onClick={() => updateDraft(activeKey, { images: draft.images.filter((item) => item.id !== image.id) })}><X /></IconButton></div>)}{currentUploading > 0 && <span className="uploading-tile"><LoaderCircle className="spin" />{currentUploading} 张上传中</span>}</div>}
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              value={draft.text}
              onChange={(event) => updateDraft(activeKey, { text: event.target.value })}
              onKeyDown={onComposerKeyDown}
              placeholder="写下你的问题或心事…"
              aria-label="对话内容"
              rows={1}
              maxLength={12000}
            />
            <input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ''; }} />
            <div className="composer__tools">
              <IconButton type="button" label={supportsImages ? `上传图片，单张不超过 ${config.max_upload_mb}MB` : '当前模式模型不支持图片'} disabled={!supportsImages || draft.images.length >= 4 || currentUploading > 0} onClick={() => fileInput.current?.click()}><ImagePlus /></IconButton>
              <div className="composer__length" role="group" aria-label="回复篇幅">
                <button type="button" aria-pressed={lengthMode === 'concise'} data-tooltip="简练：突出重点，缩短回复与解读" onClick={() => selectLengthMode('concise')}>简练</button>
                <button type="button" aria-pressed={lengthMode === 'detailed'} data-tooltip="详细：充分展开回复与解读" onClick={() => selectLengthMode('detailed')}>详细</button>
              </div>
              <span className="composer__hint">Enter 发送 · Shift + Enter 换行</span>
            </div>
            {currentStream?.active ? <IconButton type="button" className="composer__send composer__send--stop" label="停止等待" onClick={cancelStream}><Square /></IconButton> : <IconButton className="composer__send" label="发送消息" type="submit" disabled={creating || currentUploading > 0 || !modelReady || (!draft.text.trim() && !draft.images.length)}>{creating ? <LoaderCircle className="spin" /> : <Send />}</IconButton>}
          </form>
        </footer>
      </section>
      {ceremony && <Ceremony key={ceremony.id} draw={ceremony} conversationId={ceremony.conversation_id} onRevealed={upsertDraw} onFinish={(draw) => { upsertDraw(draw); setCeremony(null); }} onClose={() => setCeremony(null)} />}
      {renaming && (
        <Modal title="为这段星轨命名" onClose={() => setRenaming(null)} closeDisabled={renameSaving} className="modal--small">
          <form onSubmit={saveTitle}>
            <Field label="对话名称" error={renameError}><input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required maxLength={80} placeholder="输入新名称" /></Field>
            <div className="modal__actions"><Button type="button" variant="ghost" onClick={() => setRenaming(null)}>取消</Button><Button type="submit" loading={renameSaving}>保存名称</Button></div>
          </form>
        </Modal>
      )}
      {deleteTarget && <ConfirmDialog title={`删除${deleteTarget.title ? `「${deleteTarget.title}」` : '这段星轨'}？`} description="对话和其中的消息将永久删除，无法恢复。" loading={deleteSaving} onClose={() => setDeleteTarget(null)} onConfirm={() => void removeConversation()} />}
    </main>
  );
}
