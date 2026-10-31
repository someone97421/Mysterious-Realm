import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Orbit, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, jsonBody } from '../api';
import type { AstrologyProvider, AstrologyService, AstrologySettings, ToolUsage } from '../types';
import { errorMessage, formatDate } from '../utils';
import { Button, ConfirmDialog, EmptyState, Field, IconButton, InlineNotice, LoadingBlock, Modal } from './ui';

interface ServiceForm {
  name: string;
  provider: AstrologyProvider;
  enabled: boolean;
  priority: number;
  api_key: string;
  clear_api_key: boolean;
}

const blankService = (services: AstrologyService[]): ServiceForm => ({
  name: '', provider: 'astroway', enabled: true, api_key: '', clear_api_key: false,
  priority: services.length ? Math.max(...services.map(service => service.priority)) + 1 : 1,
});

export function AstrologyAdmin() {
  const [settings, setSettings] = useState<AstrologySettings | null>(null);
  const [usage, setUsage] = useState<ToolUsage | null>(null);
  const [tools, setTools] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [usageError, setUsageError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<AstrologyService | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ServiceForm>(() => blankService([]));
  const [formError, setFormError] = useState('');
  const [serviceSaving, setServiceSaving] = useState(false);
  const [deleting, setDeleting] = useState<AstrologyService | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [toggling, setToggling] = useState('');

  const loadUsage = useCallback(async () => { setUsageError(''); try { setUsage(await api<ToolUsage>('/api/admin/astrology/usage')); } catch { setUsageError('工具用量加载失败'); } }, []);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const value = await api<AstrologySettings>('/api/admin/astrology'); setSettings(value); setTools(value.enabled_tools.join('\n')); }
    catch { setError('占星设置加载失败，请重试'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); void loadUsage(); }, [load, loadUsage]);

  const update = (patch: Partial<Omit<AstrologySettings, 'services'>>) => { setSuccess(''); setSettings(value => value ? { ...value, ...patch } : value); };
  const setServices = (services: AstrologyService[]) => setSettings(value => value ? { ...value, services } : value);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!settings || saving) return;
    setSaving(true); setError(''); setSuccess('');
    const payload = {
      allow_credit_spend: settings.allow_credit_spend,
      allow_unknown_cost: settings.allow_unknown_cost,
      max_credits: settings.max_credits,
      timeout: settings.timeout,
      cache_enabled: settings.cache_enabled,
      enabled_tools: [...new Set(tools.split(/[\n,]/).map(item => item.trim()).filter(Boolean))],
    };
    try {
      await api('/api/admin/astrology', { method: 'PUT', body: jsonBody(payload) });
      const result = await api<AstrologySettings>('/api/admin/astrology');
      setSettings(result); setTools(result.enabled_tools.join('\n')); setSuccess('全局调用设置已保存');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  };

  const openEditor = (service?: AstrologyService) => {
    setEditing(service || null);
    setForm(service ? { name: service.name, provider: service.provider, enabled: service.enabled, priority: service.priority, api_key: '', clear_api_key: false } : blankService(settings?.services || []));
    setFormError(''); setOpen(true);
  };
  const saveService = async (event: FormEvent) => {
    event.preventDefault(); if (serviceSaving) return;
    setServiceSaving(true); setFormError(''); setError(''); setSuccess('');
    const payload: Record<string, unknown> = { name: form.name.trim(), provider: form.provider, enabled: form.enabled, priority: Number(form.priority) };
    if (form.provider === 'astroway') {
      if (form.api_key) payload.api_key = form.api_key;
      if (editing && form.clear_api_key) payload.clear_api_key = true;
    }
    try {
      const saved = await api<AstrologyService>(editing ? `/api/admin/astrology/services/${editing.id}` : '/api/admin/astrology/services', { method: editing ? 'PUT' : 'POST', body: jsonBody(payload) });
      const services = settings?.services || [];
      setServices(editing ? services.map(item => item.id === saved.id ? saved : item) : [...services, saved]);
      setOpen(false); setSuccess(editing ? '服务配置已更新' : '服务配置已添加');
    } catch (reason) { setFormError(errorMessage(reason)); }
    finally { setServiceSaving(false); }
  };
  const toggle = async (service: AstrologyService) => {
    if (toggling) return;
    setToggling(service.id); setError(''); setSuccess('');
    try {
      const saved = await api<AstrologyService>(`/api/admin/astrology/services/${service.id}`, { method: 'PUT', body: jsonBody({ name: service.name, provider: service.provider, enabled: !service.enabled, priority: service.priority }) });
      setServices((settings?.services || []).map(item => item.id === saved.id ? saved : item));
      setSuccess(`${saved.name}已${saved.enabled ? '启用' : '停用'}`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setToggling(''); }
  };
  const remove = async () => {
    if (!deleting) return;
    setDeleteSaving(true); setError('');
    try {
      await api(`/api/admin/astrology/services/${deleting.id}`, { method: 'DELETE' });
      setServices((settings?.services || []).filter(item => item.id !== deleting.id));
      setSuccess('服务配置已删除'); setDeleting(null);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setDeleteSaving(false); }
  };

  const services = [...(settings?.services || [])].sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
  return <section>
    <header className="admin-section-header"><div><span className="eyebrow">ASTROLOGY</span><h1>占星服务</h1></div><Button onClick={() => openEditor()} disabled={!settings}><Plus />添加服务</Button></header>
    {loading && <LoadingBlock />}{error && <InlineNotice tone="error">{error}</InlineNotice>}{success && <InlineNotice tone="success">{success}</InlineNotice>}{!loading && !settings && <Button onClick={() => void load()}>重新加载</Button>}
    {settings && <>
      <section className="astrology-services" aria-labelledby="astrology-services-title"><header className="astrology-subheader"><div><h2 id="astrology-services-title">故障转移顺序</h2><small>按优先级从小到大调用</small></div><span>{services.filter(service => service.enabled).length} / {services.length} 已启用</span></header>
        {!services.length ? <EmptyState icon={<Orbit />} title="尚未配置占星服务" description="添加 CosmyDay 或 AstroWay 服务卡。" action={<Button onClick={() => openEditor()}><Plus />添加服务</Button>} /> : <div className="astrology-service-grid">{services.map((service, index) => <article className={`astrology-service-card ${service.enabled ? '' : 'is-disabled'}`} key={service.id} style={{ '--item-index': Math.min(index, 8) } as React.CSSProperties}>
          <header><span className="astrology-service-card__icon"><Orbit /></span><div><h3>{service.name}</h3><p>{service.provider === 'cosmyday' ? 'CosmyDay' : 'AstroWay'}</p></div><span className={service.enabled ? 'active-badge' : 'inactive-badge'}>{service.enabled ? '已启用' : '已停用'}</span></header>
          <div className="astrology-service-card__meta"><span>优先级 <strong>{service.priority}</strong></span><span className={service.provider === 'cosmyday' || service.has_api_key ? 'key-ready' : 'key-missing'}>{service.provider === 'astroway' && <KeyRound />}{service.provider === 'cosmyday' ? '无需密钥' : service.has_api_key ? '密钥已保存' : '未配置密钥'}</span></div>
          <footer><label className="switch-row"><input type="checkbox" checked={service.enabled} disabled={toggling === service.id} onChange={() => void toggle(service)} /><span className="switch" /><span>{service.enabled ? '启用中' : '已停用'}</span></label><div><IconButton label={`编辑${service.name}`} disabled={toggling === service.id} onClick={() => openEditor(service)}><Pencil /></IconButton><IconButton label={`删除${service.name}`} disabled={toggling === service.id} onClick={() => setDeleting(service)}><Trash2 /></IconButton></div></footer>
        </article>)}</div>}
      </section>
      <form className="service-settings" onSubmit={save}><header className="astrology-subheader"><div><h2>全局调用约束</h2><small>应用于全部服务卡</small></div></header><fieldset disabled={saving}><div className="form-grid">
        <Field label="单次积分上限" hint="留空表示不设上限"><input type="number" min="0" max="1000000" step="1" value={settings.max_credits ?? ''} onChange={event => update({ max_credits: event.target.value === '' ? null : Number(event.target.value) })} /></Field>
        <Field label="请求超时（秒）"><input type="number" min="1" step="1" required value={settings.timeout} onChange={event => update({ timeout: Number(event.target.value) })} /></Field>
        <label className="switch-row"><input type="checkbox" checked={settings.allow_credit_spend} onChange={event => update({ allow_credit_spend: event.target.checked })} /><span className="switch" />允许消耗积分</label>
        <label className="switch-row"><input type="checkbox" checked={settings.allow_unknown_cost} onChange={event => update({ allow_unknown_cost: event.target.checked })} /><span className="switch" />允许未知费用的调用</label>
        <label className="switch-row"><input type="checkbox" checked={settings.cache_enabled} onChange={event => update({ cache_enabled: event.target.checked })} /><span className="switch" />启用计算缓存</label>
        <Field label="启用的工具" className="form-grid__wide" hint="每行一个工具标识，留空禁用全部工具"><textarea rows={5} value={tools} onChange={event => { setTools(event.target.value); setSuccess(''); }} /></Field>
      </div></fieldset><div className="modal__actions"><Button loading={saving}>保存全局设置</Button></div></form>
    </>}
    {open && <Modal title={editing ? '编辑占星服务' : '添加占星服务'} eyebrow="SERVICE ROUTE" onClose={() => setOpen(false)} closeDisabled={serviceSaving}><form onSubmit={saveService}>{formError && <InlineNotice tone="error">{formError}</InlineNotice>}<div className="form-grid">
      <Field label="配置名称"><input autoFocus required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：主用 AstroWay" /></Field>
      <Field label="服务类型"><select value={form.provider} onChange={event => { const provider = event.target.value as AstrologyProvider; setForm({ ...form, provider, api_key: '', clear_api_key: false }); }}><option value="astroway">AstroWay</option><option value="cosmyday">CosmyDay</option></select></Field>
      <Field label="优先级" hint="数字越小越先调用"><input type="number" min="0" max="100000" step="1" required value={form.priority} onChange={event => setForm({ ...form, priority: Number(event.target.value) })} /></Field>
      <Field label="服务状态"><label className="switch-row"><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} /><span className="switch" /><span>{form.enabled ? '启用' : '停用'}</span></label></Field>
      {form.provider === 'astroway' && <><Field label="API Key" className="form-grid__wide" hint={editing?.has_api_key ? '已保存；留空保留，提交后不再回显' : '密钥仅用于服务端连接'}><input type="password" autoComplete="new-password" value={form.api_key} disabled={form.clear_api_key} onChange={event => setForm({ ...form, api_key: event.target.value })} /></Field>{editing?.has_api_key && <label className="switch-row form-grid__wide"><input type="checkbox" checked={form.clear_api_key} onChange={event => setForm({ ...form, clear_api_key: event.target.checked, api_key: '' })} /><span className="switch" />清除已保存密钥</label>}</>}
    </div><div className="modal__actions"><Button type="button" variant="ghost" disabled={serviceSaving} onClick={() => setOpen(false)}>取消</Button><Button loading={serviceSaving}>{editing ? '保存服务' : '添加服务'}</Button></div></form></Modal>}
    {deleting && <ConfirmDialog title={`删除 ${deleting.name}？`} description="此服务卡及其密钥配置将被移除，此操作无法恢复。" loading={deleteSaving} onClose={() => setDeleting(null)} onConfirm={() => void remove()} />}
    <section className="stats-section"><header><h2>工具调用用量</h2><Button variant="ghost" onClick={() => void loadUsage()}>刷新用量</Button></header>{usageError && <InlineNotice tone="error">{usageError}</InlineNotice>}{!usage && !usageError && <LoadingBlock />}{usage && <><div className="metric-grid"><article><span>调用次数</span><strong>{usage.totals.calls}</strong></article><article><span>已知积分消耗</span><strong>{usage.totals.credits ?? '未知'}</strong><small>未知费用不计为零</small></article><article><span>缓存命中</span><strong>{usage.totals.cache_hits}</strong></article></div>{!usage.recent.length ? <small className="hint">暂无工具调用记录</small> : <div className="stats-table-wrap tool-usage-table"><table className="stats-table"><thead><tr><th>时间 / 工具</th><th>服务</th><th>状态</th><th>积分</th><th>缓存</th><th>错误码</th></tr></thead><tbody>{usage.recent.map(row => <tr key={row.id}><td><strong>{row.tool}</strong><small>{formatDate(row.created_at, true)}</small></td><td>{row.provider}</td><td>{({ success: '成功', complete: '完成', error: '失败', running: '进行中', cancelled: '已取消' } as Record<string, string>)[row.status] || row.status}</td><td>{row.credits ?? '未知'}</td><td>{row.cache_hit ? '命中' : '未命中'}</td><td>{row.error_code || '—'}</td></tr>)}</tbody></table></div>}</>}</section>
  </section>;
}
