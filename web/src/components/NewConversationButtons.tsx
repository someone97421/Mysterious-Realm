import { Plus } from 'lucide-react';
import type { Mode } from '../types';
import { ModeMark } from './ModeSwitcher';
import { Button } from './ui';

const entries: { mode: Mode; title: string; label: string }[] = [
  { mode: 'tarot', title: '塔罗问心', label: '新建塔罗对话' },
  { mode: 'astrology', title: '星图寻迹', label: '新建星座对话' },
];

export function NewConversationButtons({ mode, onNew, disabled = false, switchingDisabled = false }: {
  mode: Mode;
  onNew: (mode: Mode) => void;
  disabled?: boolean;
  switchingDisabled?: boolean;
}) {
  return <div className="new-conversations" role="group" aria-label="开启新的对话">
    {entries.map(entry => <Button key={entry.mode} type="button" className={`new-chat new-chat--${entry.mode}`} variant="secondary" disabled={disabled || (switchingDisabled && entry.mode !== mode)} aria-label={`${entry.title}，${entry.label}`} onClick={() => onNew(entry.mode)}>
      <ModeMark mode={entry.mode} />
      <span className="new-chat__copy"><strong>{entry.title}</strong><small>{entry.label}</small></span>
      <Plus aria-hidden="true" />
    </Button>)}
  </div>;
}
