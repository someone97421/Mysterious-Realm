import { ArrowLeft, BarChart3, Boxes, LogOut, Orbit, ShieldCheck, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ModelConfig, User } from '../types';
import { errorMessage, cx } from '../utils';
import { ModelsAdmin } from './ModelsAdmin';
import { AstrologyAdmin } from './AstrologyAdmin';
import { StatsAdmin } from './StatsAdmin';
import { UsersAdmin } from './UsersAdmin';
import { Brand, IconButton, InlineNotice, LoadingBlock, ToastRegion, type ToastItem } from './ui';

type AdminTab = 'users' | 'models' | 'astrology' | 'stats';

export function Admin({ user, onBack, onLogout }: { user: User; onBack: () => void; onLogout: () => void }) {
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userList, modelList] = await Promise.all([api<User[]>('/api/admin/users'), api<ModelConfig[]>('/api/admin/models')]);
      setUsers(userList); setModels(modelList); setError('');
    } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const notify = (message: string, tone: ToastItem['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((previous) => [...previous, { id, message, tone }]);
    window.setTimeout(() => setToasts((previous) => previous.filter((item) => item.id !== id)), 4200);
  };
  const tabs = [{ id: 'users' as const, label: '账号', icon: UsersRound }, { id: 'models' as const, label: '模型', icon: Boxes }, { id: 'astrology' as const, label: '占星服务', icon: Orbit }, { id: 'stats' as const, label: 'Token 统计', icon: BarChart3 }];
  return (
    <main className="admin-shell">
      <aside className="admin-sidebar"><Brand compact /><div className="admin-sidebar__label"><ShieldCheck /><span>秘域管理台</span></div><nav aria-label="管理功能">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={cx(tab === id && 'is-active')} onClick={() => setTab(id)}><Icon /><span>{label}</span></button>)}</nav><div className="admin-sidebar__bottom"><button onClick={onBack}><ArrowLeft />返回对话</button><button onClick={onLogout}><LogOut />退出登录</button></div></aside>
      <section className="admin-main">
        <header className="admin-topbar"><button className="admin-back" onClick={onBack}><ArrowLeft />返回秘域</button><div className="admin-mobile-tabs">{tabs.map(({ id, label, icon: Icon }) => <IconButton key={id} label={label} active={tab === id} onClick={() => setTab(id)}><Icon /></IconButton>)}</div><div className="admin-identity"><span>{user.display_name.slice(0, 1)}</span><div><strong>{user.display_name}</strong><small>管理员</small></div></div></header>
        <div className="admin-content">
          {loading && <LoadingBlock className="admin-loading" />}
          {!loading && error && <div className="admin-load-error"><InlineNotice tone="error">{error}</InlineNotice><button className="button button--secondary" onClick={() => void load()}>重新加载</button></div>}
          {!loading && !error && tab === 'users' && <UsersAdmin currentUser={user} users={users} setUsers={setUsers} notify={notify} />}
          {!loading && !error && tab === 'models' && <ModelsAdmin models={models} setModels={setModels} notify={notify} />}
          {!loading && !error && tab === 'stats' && <StatsAdmin users={users} models={models} />}
          {!loading && !error && tab === 'astrology' && <AstrologyAdmin />}
        </div>
      </section>
      <ToastRegion items={toasts} onDismiss={(id) => setToasts((previous) => previous.filter((item) => item.id !== id))} />
    </main>
  );
}
