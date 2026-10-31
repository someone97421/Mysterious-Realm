import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserRound, UsersRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, jsonBody } from '../api';
import type { Role, User } from '../types';
import { errorMessage, formatDate } from '../utils';
import { Button, ConfirmDialog, EmptyState, Field, IconButton, InlineNotice, Modal } from './ui';

interface UserForm { username: string; display_name: string; password: string; role: Role; is_active: boolean }
const blankForm: UserForm = { username: '', display_name: '', password: '', role: 'user', is_active: true };

export function UsersAdmin({ currentUser, users, setUsers, notify }: { currentUser: User; users: User[]; setUsers: React.Dispatch<React.SetStateAction<User[]>>; notify: (message: string, tone?: 'success' | 'error' | 'info') => void }) {
  const [editing, setEditing] = useState<User | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<UserForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<User | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const openEditor = (user?: User) => { setEditing(user ?? null); setForm(user ? { username: user.username, display_name: user.display_name, password: '', role: user.role, is_active: user.is_active } : blankForm); setError(''); setEditorOpen(true); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const payload: Record<string, unknown> = { username: form.username.trim(), display_name: form.display_name.trim(), role: form.role, is_active: form.is_active };
      if (!editing || form.password) payload.password = form.password;
      const saved = await api<User>(editing ? `/api/admin/users/${editing.id}` : '/api/admin/users', { method: editing ? 'PATCH' : 'POST', body: jsonBody(payload) });
      setUsers((previous) => editing ? previous.map((item) => item.id === saved.id ? saved : item) : [saved, ...previous]);
      setEditorOpen(false); notify(editing ? '账号信息已更新' : '新账号已创建');
    } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!deleting || deleting.id === currentUser.id) return;
    setDeleteSaving(true);
    try { await api<{ ok: true }>(`/api/admin/users/${deleting.id}`, { method: 'DELETE' }); setUsers((previous) => previous.filter((item) => item.id !== deleting.id)); notify('账号及其聊天、上传已删除'); setDeleting(null); }
    catch (reason) { notify(errorMessage(reason), 'error'); } finally { setDeleteSaving(false); }
  };
  const isSelf = editing?.id === currentUser.id;
  return (
    <section>
      <header className="admin-section-header"><div><span className="eyebrow">ACCOUNT CONSTELLATION</span><h1>账号卡片</h1><p>管理秘域成员与访问权限。</p></div><Button onClick={() => openEditor()}><Plus />新建账号</Button></header>
      {users.length === 0 ? <EmptyState icon={<UsersRound />} title="还没有成员" action={<Button onClick={() => openEditor()}><Plus />创建首位成员</Button>} /> : <div className="account-grid">{users.map((user, index) => {
        const self = user.id === currentUser.id;
        return <article className="account-card" key={user.id} style={{ '--item-index': Math.min(index, 8) } as React.CSSProperties}><header><span className="account-card__avatar">{user.display_name.slice(0, 1)}</span><div className="account-card__badges"><span className={`role-badge role-badge--${user.role}`}>{user.role === 'admin' ? <ShieldCheck /> : <UserRound />}{user.role === 'admin' ? '管理员' : '成员'}</span><span className={user.is_active ? 'active-badge' : 'inactive-badge'}>{user.is_active ? '已启用' : '已停用'}</span></div></header><div className="account-card__identity"><h2>{user.display_name}{self && <small>你</small>}</h2><p>@{user.username}</p></div><footer><time>加入于 {formatDate(user.created_at)}</time><div><IconButton label="编辑账号" onClick={() => openEditor(user)}><Pencil /></IconButton><IconButton label={self ? '不能删除当前账号' : '删除账号'} disabled={self} onClick={() => setDeleting(user)}><Trash2 /></IconButton></div></footer></article>;
      })}</div>}
      {editorOpen && <Modal title={editing ? '编辑账号' : '新建账号'} eyebrow="成员星轨" onClose={() => setEditorOpen(false)} closeDisabled={saving} className="modal--form"><form onSubmit={save}>{error && <InlineNotice tone="error">{error}</InlineNotice>}<div className="form-grid">
        <Field label="登录账号"><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required maxLength={64} autoComplete="off" /></Field>
        <Field label="显示名称"><input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} required maxLength={64} /></Field>
        <Field label={editing ? '重置密码' : '登录密码'} hint={editing ? '留空则保留原密码' : undefined} className="form-grid__wide"><div className="input-with-icon"><KeyRound /><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required={!editing} autoComplete="new-password" placeholder={editing ? '不修改请留空' : '设置登录密码'} /></div></Field>
        <Field label="角色" hint={isSelf ? '不能降低自己的管理权限' : undefined}><select value={form.role} disabled={isSelf} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}><option value="user">成员</option><option value="admin">管理员</option></select></Field>
        <Field label="账号状态" hint={isSelf ? '不能停用当前账号' : undefined}><label className="switch-row"><input type="checkbox" checked={form.is_active} disabled={isSelf} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /><span className="switch" /><span>{form.is_active ? '允许登录' : '禁止登录'}</span></label></Field>
      </div><div className="modal__actions"><Button type="button" variant="ghost" onClick={() => setEditorOpen(false)}>取消</Button><Button type="submit" loading={saving}>{editing ? '保存修改' : '创建账号'}</Button></div></form></Modal>}
      {deleting && <ConfirmDialog title={`删除 ${deleting.display_name}？`} description="此操作会同时删除该账号的全部聊天与上传，且无法恢复。" loading={deleteSaving} onClose={() => setDeleting(null)} onConfirm={() => void remove()} />}
    </section>
  );
}
