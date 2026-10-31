import { Pencil, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Conversation } from '../types';
import { cx, formatDate } from '../utils';
import { ModeMark } from './ModeSwitcher';
import { IconButton } from './ui';

export function ConversationCard({ conversation, selected, index, generating = false, disabled = false, actionsDisabled = false, error, onOpen, onRename, onDelete }: {
  conversation: Conversation;
  selected: boolean;
  index: number;
  generating?: boolean;
  disabled?: boolean;
  actionsDisabled?: boolean;
  error?: string;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const title = conversation.title || '未命名对话';
  return <div className={cx('conversation-row', `conversation-row--${conversation.mode}`, selected && 'is-active')} style={{ '--item-index': Math.min(index, 8) } as CSSProperties}>
    <button className={cx('conversation-item', `conversation-item--${conversation.mode}`, selected && 'is-active')} disabled={disabled} aria-current={selected ? 'page' : undefined} onClick={onOpen}>
      <ModeMark mode={conversation.mode} />
      <span className="conversation-item__copy"><strong>{title}</strong><small className={error ? 'conversation-item__error' : undefined}>{error || `${conversation.mode === 'tarot' ? '塔罗' : '星座'} · ${formatDate(conversation.updated_at, true)}`}</small></span>
      {generating && <i className="conversation-item__live" aria-label="正在回应" />}
    </button>
    <div className="conversation-actions">
      <IconButton label={`重命名「${title}」`} disabled={actionsDisabled || generating} onClick={onRename}><Pencil /></IconButton>
      <IconButton className="conversation-actions__delete" label={`删除「${title}」`} disabled={actionsDisabled || generating} onClick={onDelete}><Trash2 /></IconButton>
    </div>
  </div>;
}
