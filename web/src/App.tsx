import { LoadingScreen } from './components/LoadingScreen';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Admin } from './components/Admin';
import { Auth } from './components/Auth';
import { AstrologyChat } from './components/AstrologyChat';
import { Chat } from './components/Chat';
import { ModeTransition } from './components/ModeTransition';
import { RealmGateway } from './components/RealmGateway';
import { Button, InlineNotice } from './components/ui';
import type { AppConfig, Conversation, Mode, User } from './types';
import { errorMessage } from './utils';

type WorkspaceTransition = { mode: Mode; conversationId: string | null; phase: 'cover' | 'reveal' };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState('');
  const [mode, setMode] = useState<Mode | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null | undefined>(undefined);
  const [transition, setTransition] = useState<WorkspaceTransition | null>(null);
  const [adminRoute, setAdminRoute] = useState(() => window.location.hash === '#/admin');

  useEffect(() => {
    if (mode) document.documentElement.dataset.mode = mode;
    else delete document.documentElement.dataset.mode;
  }, [mode]);
  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const result = await api<{ user: User | null; setup_required: boolean }>('/api/auth/me');
      setUser(result.user); setSetupRequired(result.setup_required); setAuthError('');
    } catch (reason) { setAuthError(errorMessage(reason)); }
    finally { setAuthLoading(false); }
  }, []);
  useEffect(() => { void checkAuth(); }, [checkAuth]);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try { const value = await api<AppConfig>('/api/config'); setConfig(value); setConfigError(''); document.title = value.app_name; }
    catch (reason) { setConfigError(errorMessage(reason)); }
    finally { setConfigLoading(false); }
  }, []);
  useEffect(() => {
    if (!user) { setConfig(null); return; }
    const stored = localStorage.getItem(`xingwei.mode.${user.id}`);
    setMode(stored === 'astrology' || stored === 'tarot' ? stored : null);
    setActiveConversationId(undefined);
    setConfig(null);
    void loadConfig();
  }, [user?.id, loadConfig]);
  useEffect(() => {
    const onHash = () => setAdminRoute(window.location.hash === '#/admin');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const logout = async () => {
    try { await api<{ ok: true }>('/api/auth/logout', { method: 'POST' }); } catch { /* 本地会话仍需退出 */ }
    window.location.hash = '';
    setUser(null); setConfig(null); setSetupRequired(false); setMode(null); setActiveConversationId(undefined); setTransition(null);
  };
  const authenticated = (value: User) => {
    localStorage.removeItem(`xingwei.active.${value.id}.tarot`);
    localStorage.removeItem(`xingwei.active.${value.id}.astrology`);
    localStorage.removeItem(`xingwei.mode.${value.id}`);
    window.location.hash = '';
    setSetupRequired(false); setUser(value);
  };
  const backToChat = () => { window.location.hash = ''; setAdminRoute(false); void loadConfig(); };
  const goHome = () => {
    if (!user || transition) return;
    localStorage.removeItem(`xingwei.mode.${user.id}`);
    setMode(null);
    setActiveConversationId(undefined);
  };
  const switchMode = async (next: Mode) => {
    if (next === mode || !user || transition) return;
    setTransition({ mode: next, conversationId: null, phase: 'cover' });
  };
  const openConversation = (conversation: Conversation) => {
    if (!user || transition) return;
    if (conversation.mode !== mode) {
      setTransition({ mode: conversation.mode, conversationId: conversation.id, phase: 'cover' });
      return;
    }
    localStorage.setItem(`xingwei.active.${user.id}.${conversation.mode}`, conversation.id);
    setActiveConversationId(conversation.id);
  };
  const revealWorkspace = () => {
    if (!transition || transition.phase !== 'cover' || !user) return;
    localStorage.setItem(`xingwei.mode.${user.id}`, transition.mode);
    const storageKey = `xingwei.active.${user.id}.${transition.mode}`;
    if (transition.conversationId) localStorage.setItem(storageKey, transition.conversationId);
    else localStorage.removeItem(storageKey);
    setMode(transition.mode);
    setActiveConversationId(transition.conversationId);
    setTransition({ ...transition, phase: 'reveal' });
  };

  if (authLoading) return <LoadingScreen message="正在开启秘域" />;
  if (authError) return <LoadingScreen message="暂时未能连接秘域" busy={false}><InlineNotice tone="error">{authError}</InlineNotice><Button variant="secondary" onClick={() => void checkAuth()}>重新连接</Button></LoadingScreen>;
  if (!user) return <Auth setupRequired={setupRequired} onAuthenticated={authenticated} />;
  if (configLoading && !config) return <LoadingScreen message="正在感知星辰能力" />;
  if (configError && !config) return <LoadingScreen message="探索暂未就绪" busy={false}><InlineNotice tone="error">{configError}</InlineNotice><Button variant="secondary" onClick={() => void loadConfig()}>重试</Button><Button variant="ghost" onClick={() => void logout()}>退出登录</Button></LoadingScreen>;
  if (!config) return <LoadingScreen message="正在准备探索空间" />;
  if (adminRoute && user.role === 'admin') return <Admin user={user} onBack={backToChat} onLogout={() => void logout()} />;
  if (!mode) return <>
    <div ref={element => { if (element) element.inert = !!transition; }}>
      <RealmGateway user={user} busy={!!transition} onSelect={next => void switchMode(next)} onAdmin={() => { window.location.hash = '#/admin'; }} onLogout={() => void logout()} />
    </div>
    {transition && <ModeTransition mode={transition.mode} phase={transition.phase} onCovered={revealWorkspace} onFinished={() => setTransition(null)} />}
  </>;
  const workspaceKey = `${user.id}:${mode}:${activeConversationId === undefined ? 'stored' : activeConversationId || 'new'}`;
  const common = { user, config, onLogout: () => void logout(), onAdmin: () => { setActiveConversationId(undefined); window.location.hash = '#/admin'; }, onHome: goHome, mode, initialConversationId: activeConversationId, onOpenConversation: openConversation, onSwitchMode: switchMode };
  return <>
    <div className="mode-workspace" ref={element => { if (element) element.inert = !!transition; }}>
      {mode === 'astrology' ? <AstrologyChat key={workspaceKey} {...common} /> : <Chat key={workspaceKey} {...common} />}
    </div>
    {transition && <ModeTransition mode={transition.mode} phase={transition.phase} onCovered={revealWorkspace} onFinished={() => setTransition(null)} />}
  </>;
}
