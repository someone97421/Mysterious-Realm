import { LoaderCircle, MoonStar } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Admin } from './components/Admin';
import { Auth } from './components/Auth';
import { Chat } from './components/Chat';
import { Brand, Button, InlineNotice } from './components/ui';
import type { AppConfig, User } from './types';
import { errorMessage } from './utils';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState('');
  const [adminRoute, setAdminRoute] = useState(() => window.location.hash === '#/admin');

  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const result = await api<{ user: User | null; setup_required: boolean }>('/api/auth/me');
      setUser(result.user);
      setSetupRequired(result.setup_required);
      setAuthError('');
    } catch (reason) { setAuthError(errorMessage(reason)); } finally { setAuthLoading(false); }
  }, []);
  useEffect(() => { void checkAuth(); }, [checkAuth]);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try { const value = await api<AppConfig>('/api/config'); setConfig(value); setConfigError(''); document.title = value.app_name; }
    catch (reason) { setConfigError(errorMessage(reason)); } finally { setConfigLoading(false); }
  }, []);
  useEffect(() => { if (user) { setConfig(null); void loadConfig(); } else setConfig(null); }, [user?.id, loadConfig]);
  useEffect(() => {
    const onHash = () => setAdminRoute(window.location.hash === '#/admin');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const logout = async () => {
    try { await api<{ ok: true }>('/api/auth/logout', { method: 'POST' }); } catch { /* 本地会话仍需退出 */ }
    window.location.hash = '';
    setUser(null); setConfig(null); setSetupRequired(false);
  };
  const authenticated = (value: User) => {
    sessionStorage.setItem('xingwei.fresh-login', value.id);
    window.location.hash = '';
    setSetupRequired(false); setUser(value);
  };
  const backToChat = () => { window.location.hash = ''; setAdminRoute(false); void loadConfig(); };

  if (authLoading) return <main className="app-loading"><Brand /><LoaderCircle className="spin" /><span>正在点亮星帷</span></main>;
  if (authError) return <main className="app-loading"><Brand /><InlineNotice tone="error">{authError}</InlineNotice><Button variant="secondary" onClick={() => void checkAuth()}>重新连接</Button></main>;
  if (!user) return <Auth setupRequired={setupRequired} onAuthenticated={authenticated} />;
  if (configLoading && !config) return <main className="app-loading"><Brand /><LoaderCircle className="spin" /><span>正在感知星辰能力</span></main>;
  if (configError && !config) return <main className="app-loading"><Brand /><InlineNotice tone="error">{configError}</InlineNotice><Button variant="secondary" onClick={() => void loadConfig()}>重试</Button><Button variant="ghost" onClick={() => void logout()}>退出登录</Button></main>;
  if (!config) return <main className="app-loading"><MoonStar /></main>;
  if (adminRoute && user.role === 'admin') return <Admin user={user} onBack={backToChat} onLogout={() => void logout()} />;
  return <Chat key={user.id} user={user} config={config} onLogout={() => void logout()} onAdmin={() => { window.location.hash = '#/admin'; }} />;
}
