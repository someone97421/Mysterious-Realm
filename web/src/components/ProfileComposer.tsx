import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import { ImagePlus, LoaderCircle, Plus, Send, Square, X } from 'lucide-react';
import { api } from '../api';
import type { ImageAsset, LengthMode, Profile } from '../types';
import { errorMessage } from '../utils';
import { Button, IconButton } from './ui';
import { ProfileSummary } from './Profiles';

export interface ComposerHandle { fill: (text: string) => void; clear: () => void }
type SendHandler = (content: string, profileIds: string[], imageIds: string[], mode: LengthMode) => void;

export const ProfileComposer = forwardRef<ComposerHandle, { profiles: Profile[]; disabled: boolean; busy: boolean; stopping: boolean; supportsImages: boolean; maxUploadMb: number; onSend: SendHandler; onStop: () => void; onManage: () => void }>(function ProfileComposer({ profiles, disabled, busy, stopping, supportsImages, maxUploadMb, onSend, onStop, onManage }, ref) {
  const editor = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selection = useRef<Range | null>(null);
  const mention = useRef<Range | null>(null);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [hasText, setHasText] = useState(false);
  const [lengthMode, setLengthMode] = useState<LengthMode>('concise');
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [summary, setSummary] = useState<{ profile: Profile; node: HTMLElement } | null>(null);
  const candidates = profiles.filter(profile => profile.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useImperativeHandle(ref, () => ({
    fill(text) { if (editor.current) { editor.current.textContent = text; selection.current = null; mention.current = null; setPicker(false); setHasText(!!text); editor.current.focus(); } },
    clear() { if (editor.current) editor.current.textContent = ''; selection.current = null; mention.current = null; setHasText(false); setPicker(false); setImages([]); setUploadError(''); },
  }));
  const remember = () => { const current = window.getSelection(); if (current?.rangeCount && editor.current?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange(); };
  const detect = () => {
    remember(); setHasText(!!editor.current?.textContent?.trim());
    const current = window.getSelection();
    if (current?.anchorNode?.nodeType === Node.TEXT_NODE && !current.anchorNode.parentElement?.closest('[data-profile]')) {
      const text = current.anchorNode.textContent?.slice(0, current.anchorOffset) || '';
      const match = text.match(/@([^@\s]*)$/);
      if (match) { const range = document.createRange(); range.setStart(current.anchorNode, current.anchorOffset - match[0].length); range.setEnd(current.anchorNode, current.anchorOffset); mention.current = range; setPicker(true); setQuery(match[1]); setIndex(0); return; }
    }
    mention.current = null; setPicker(false);
  };
  const insert = (profile: Profile) => {
    const root = editor.current; if (!root) return;
    const range = mention.current || selection.current || document.createRange();
    if (!root.contains(range.startContainer)) { range.selectNodeContents(root); range.collapse(false); }
    range.deleteContents();
    const chip = document.createElement('span');
    chip.contentEditable = 'false'; chip.dataset.profile = profile.id; chip.className = 'inline-profile'; chip.style.color = profile.color;
    chip.setAttribute('role', 'button'); chip.tabIndex = 0; chip.setAttribute('aria-label', `查看${profile.name}，可移除引用`); chip.textContent = `${profile.avatar || '✦'} ${profile.name}`;
    range.insertNode(chip); range.setStartAfter(chip); range.collapse(true);
    const space = document.createTextNode(' '); range.insertNode(space); range.setStartAfter(space); range.collapse(true);
    root.focus(); const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); selection.current = range.cloneRange(); mention.current = null;
    setPicker(false); setQuery(''); setHasText(true);
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files || !supportsImages || uploading) return;
    const available = Math.max(0, 4 - images.length);
    const selected = Array.from(files).slice(0, available);
    if (files.length > available) setUploadError('一条消息最多上传 4 张图片');
    const maxBytes = maxUploadMb * 1024 * 1024;
    const valid = selected.filter(file => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setUploadError('仅支持 PNG、JPEG 或 WebP 图片'); return false; }
      if (file.size > maxBytes) { setUploadError(`单张图片不能超过 ${maxUploadMb}MB`); return false; }
      return true;
    });
    if (!valid.length) return;
    setUploadError(''); setUploading(true);
    try {
      const uploaded: ImageAsset[] = [];
      for (const file of valid) {
        const body = new FormData(); body.append('file', file);
        uploaded.push(await api<ImageAsset>('/api/uploads', { method: 'POST', body }));
      }
      setImages(previous => [...previous, ...uploaded]);
    } catch (reason) { setUploadError(errorMessage(reason)); }
    finally { setUploading(false); }
  };
  const submit = () => {
    if (disabled || busy || !editor.current) return;
    const ids = new Set<string>();
    const serialize = (node: Node): string => {
      if (node instanceof HTMLElement && node.dataset.profile) {
        const profile = profiles.find(item => item.id === node.dataset.profile);
        if (!profile) return node.textContent || '';
        ids.add(profile.id); return `@[${profile.name.replace(/[\]\r\n]/g, ' ')}](profile:${profile.id})`;
      }
      if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/@\[([^\]]+)\]\(profile:[^)]+\)/g, '$1');
      if (node.nodeName === 'BR') return '\n';
      return Array.from(node.childNodes).map(serialize).join('') + (node.nodeName === 'DIV' && node !== editor.current ? '\n' : '');
    };
    const content = serialize(editor.current).trim();
    if (content || images.length) onSend(content, [...ids], images.map(image => image.id), lengthMode);
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (picker) {
      if (event.key === 'Escape') { event.preventDefault(); setPicker(false); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => candidates.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length : 0); return; }
      if (event.key === 'Enter') { event.preventDefault(); if (candidates[index]) insert(candidates[index]); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  };
  const inspect = (target: EventTarget) => { const node = target instanceof Element ? target.closest<HTMLElement>('[data-profile]') : null; const profile = profiles.find(item => item.id === node?.dataset.profile); if (node && profile) setSummary({ profile, node }); };

  return <div className="astro-composer">
    {picker && <div className="profile-picker"><input aria-label="搜索人物" value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={keyDown} placeholder="搜索人物…" aria-controls="profile-options" aria-activedescendant={candidates[index] ? `pick-${candidates[index].id}` : undefined} /><div id="profile-options" role="listbox" aria-label="人物">{candidates.map((profile, candidateIndex) => <button type="button" role="option" aria-selected={candidateIndex === index} id={`pick-${profile.id}`} key={profile.id} onMouseDown={event => event.preventDefault()} onClick={() => insert(profile)}><span style={{ color: profile.color }}>{profile.avatar || '✦'}</span><span>{profile.name}<small>{profile.birth_date || '生日未知'}</small></span></button>)}</div>{!candidates.length && <small className="hint">没有匹配的人物</small>}<Button variant="ghost" onClick={() => { setPicker(false); onManage(); }}>管理 / 新建人物</Button></div>}
    {(images.length > 0 || uploading || uploadError) && <div className="astro-upload-row">{images.map(image => <div key={image.id}><img src={image.url} alt={image.original_name} /><IconButton label={`移除 ${image.original_name}`} onClick={() => setImages(previous => previous.filter(item => item.id !== image.id))}><X /></IconButton></div>)}{uploading && <span className="uploading-tile"><LoaderCircle className="spin" />上传中</span>}{uploadError && <small className="composer-error">{uploadError}</small>}</div>}
    <div ref={editor} className="token-editor" role="textbox" aria-label="向秘域提问，输入 @ 引用人物" aria-multiline="true" aria-expanded={picker} aria-controls={picker ? 'profile-options' : undefined} contentEditable={!disabled && !busy} suppressContentEditableWarning data-placeholder="此刻，你想从星辰中了解什么？输入 @ 引用人物" onInput={detect} onKeyUp={remember} onMouseUp={remember} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).dataset.profile) { event.preventDefault(); inspect(event.target); return; } keyDown(event); }} onClick={event => inspect(event.target)} onPaste={event => { event.preventDefault(); const text = event.clipboardData.getData('text/plain'); const current = window.getSelection(); if (!current?.rangeCount) return; const range = current.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); current.removeAllRanges(); current.addRange(range); detect(); }} onDrop={event => event.preventDefault()} />
    <div className="composer-actions"><IconButton label="插入人物" disabled={disabled || busy} onMouseDown={event => event.preventDefault()} onClick={() => { remember(); mention.current = null; setQuery(''); setIndex(0); setPicker(value => !value); }}><Plus /></IconButton><IconButton label={supportsImages ? `上传图片，单张不超过 ${maxUploadMb}MB` : '当前模型不支持图片'} disabled={disabled || busy || !supportsImages || images.length >= 4 || uploading} onClick={() => fileInput.current?.click()}><ImagePlus /></IconButton><input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => { void uploadFiles(event.target.files); event.target.value = ''; }} /><div className="composer__length">{(['concise', 'detailed'] as const).map(value => <button type="button" key={value} aria-pressed={lengthMode === value} onClick={() => setLengthMode(value)}>{value === 'concise' ? '简洁' : '详细'}</button>)}</div><small className="hint composer-key-hint">Enter 发送 · Shift Enter 换行</small>{busy ? <Button variant="secondary" loading={stopping} onClick={onStop}><Square />停止</Button> : <Button disabled={disabled || (!hasText && !images.length)} onClick={submit}><Send />发送</Button>}</div>
    {summary && <ProfileSummary profile={summary.profile} onClose={() => setSummary(null)} onRemove={() => { summary.node.remove(); setSummary(null); setHasText(!!editor.current?.textContent?.trim()); }} />}
  </div>;
});
