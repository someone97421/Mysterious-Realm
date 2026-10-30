import { Boxes, CheckCircle2, CircleGauge, Image, KeyRound, Pencil, Plus, Star, Trash2, XCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, jsonBody } from '../api';
import type { ModelConfig, ModelPayload, SchemaType } from '../types';
import { errorMessage, formatNumber } from '../utils';
import { Button, ConfirmDialog, EmptyState, Field, IconButton, InlineNotice, Modal } from './ui';

const presets: Record<string, { base_url: string; schema_type: SchemaType }> = {
  OpenAI: { base_url: 'https://api.openai.com/v1', schema_type: 'chat_completions' },
  DeepSeek: { base_url: 'https://api.deepseek.com/v1', schema_type: 'chat_completions' },
  Anthropic: { base_url: 'https://api.anthropic.com/v1', schema_type: 'anthropic' },
  Gemini: { base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', schema_type: 'chat_completions' },
};
type FormState = ModelPayload & { api_key: string };
const reasoningPresets = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const blank: FormState = { name: '', provider: 'OpenAI', base_url: presets.OpenAI.base_url, model_id: '', schema_type: 'chat_completions', reasoning_effort: 'none', reasoning_field: '', supports_images: false, context_window: 128000, compression_threshold: 0.8, max_output_tokens: 8192, api_key: '' };
interface CheckResult { ok: boolean; message: string; latency_ms: number }

export function ModelsAdmin({ models, setModels, notify }: { models: ModelConfig[]; setModels: React.Dispatch<React.SetStateAction<ModelConfig[]>>; notify: (message: string, tone?: 'success' | 'error' | 'info') => void }) {
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blank);
  const [customReasoning, setCustomReasoning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<ModelConfig | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckResult>>({});
  const [defaulting, setDefaulting] = useState<string | null>(null);
  const openEditor = (model?: ModelConfig) => { setEditing(model ?? null); setCustomReasoning(Boolean(model && !reasoningPresets.includes(model.reasoning_effort))); setForm(model ? { name: model.name, provider: model.provider, base_url: model.base_url, model_id: model.model_id, schema_type: model.schema_type, reasoning_effort: model.reasoning_effort, reasoning_field: model.reasoning_field ?? '', supports_images: model.supports_images, context_window: model.context_window, compression_threshold: model.compression_threshold, max_output_tokens: model.max_output_tokens, api_key: '' } : blank); setError(''); setOpen(true); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const payload: ModelPayload = { name: form.name.trim(), provider: form.provider.trim(), base_url: form.base_url.trim(), model_id: form.model_id.trim(), schema_type: form.schema_type, reasoning_effort: form.reasoning_effort.trim(), reasoning_field: form.reasoning_field.trim(), supports_images: form.supports_images, context_window: Number(form.context_window), compression_threshold: Number(form.compression_threshold), max_output_tokens: Number(form.max_output_tokens), ...(!editing || form.api_key ? { api_key: form.api_key } : {}) };
      const saved = await api<ModelConfig>(editing ? `/api/admin/models/${editing.id}` : '/api/admin/models', { method: editing ? 'PATCH' : 'POST', body: jsonBody(payload) });
      setModels((previous) => editing ? previous.map((item) => item.id === saved.id ? saved : item) : [saved, ...previous]); setOpen(false); notify(editing ? '模型配置已更新' : '模型已添加');
    } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(false); }
  };
  const makeDefault = async (model: ModelConfig) => {
    setDefaulting(model.id);
    try { const saved = await api<ModelConfig>(`/api/admin/models/${model.id}/default`, { method: 'POST', body: jsonBody({}) }); setModels((previous) => previous.map((item) => ({ ...item, is_default: item.id === saved.id }))); notify(`已将 ${saved.name} 设为默认模型`); }
    catch (reason) { notify(errorMessage(reason), 'error'); } finally { setDefaulting(null); }
  };
  const check = async (model: ModelConfig) => {
    setChecking(model.id);
    try { const result = await api<CheckResult>(`/api/admin/models/${model.id}/check`, { method: 'POST', body: jsonBody({}) }); setChecks((previous) => ({ ...previous, [model.id]: result })); }
    catch (reason) { setChecks((previous) => ({ ...previous, [model.id]: { ok: false, message: errorMessage(reason), latency_ms: 0 } })); } finally { setChecking(null); }
  };
  const remove = async () => {
    if (!deleting) return; setDeleteSaving(true);
    try { await api<{ ok: true }>(`/api/admin/models/${deleting.id}`, { method: 'DELETE' }); setModels((previous) => previous.filter((item) => item.id !== deleting.id)); notify('模型配置已删除'); setDeleting(null); }
    catch (reason) { notify(errorMessage(reason), 'error'); } finally { setDeleteSaving(false); }
  };
  const providerValue = presets[form.provider] ? form.provider : 'custom';
  const requiresReasoningField = form.schema_type === 'anthropic' && !reasoningPresets.includes(form.reasoning_effort.trim());
  return <section>
    <header className="admin-section-header"><div><span className="eyebrow">MODEL OBSERVATORY</span><h1>模型观测台</h1><p>配置连接、上下文与输出边界。</p></div><Button onClick={() => openEditor()}><Plus />添加模型</Button></header>
    {models.length === 0 ? <EmptyState icon={<Boxes />} title="尚未添加模型" description="添加并检查连接后，用户端才会开放发送。" action={<Button onClick={() => openEditor()}><Plus />添加模型</Button>} /> : <div className="model-grid">{models.map((model, index) => <article className="model-card" key={model.id} style={{ '--item-index': Math.min(index, 8) } as React.CSSProperties}>
      <header><span className="model-card__icon"><CircleGauge /></span><div><h2>{model.name}</h2><p>{model.provider} · {model.model_id}</p></div>{model.is_default && <span className="default-badge"><Star />默认</span>}</header>
      <div className="model-card__tags"><span>{model.schema_type}</span><span>{model.reasoning_effort}</span>{model.supports_images && <span><Image />图片</span>}<span>{formatNumber(model.context_window)} 上下文</span></div>
      <div className="model-card__meta"><span>压缩阈值 {Math.round(model.compression_threshold * 100)}%</span><span>最大输出 {formatNumber(model.max_output_tokens)}</span><span className={model.has_api_key ? 'key-ready' : 'key-missing'}><KeyRound />{model.has_api_key ? '密钥已保存' : '未配置密钥'}</span></div>
      {checks[model.id] && <div className={checks[model.id].ok ? 'check-result check-result--ok' : 'check-result check-result--error'}>{checks[model.id].ok ? <CheckCircle2 /> : <XCircle />}<span>{checks[model.id].message}</span>{checks[model.id].latency_ms > 0 && <small>{checks[model.id].latency_ms}ms</small>}</div>}
      <footer><Button variant="ghost" loading={checking === model.id} onClick={() => void check(model)}>连接检查</Button><div>{!model.is_default && <IconButton label="设为默认模型" disabled={defaulting === model.id} onClick={() => void makeDefault(model)}><Star /></IconButton>}<IconButton label="编辑模型" onClick={() => openEditor(model)}><Pencil /></IconButton><IconButton label="删除模型" onClick={() => setDeleting(model)}><Trash2 /></IconButton></div></footer>
    </article>)}</div>}
    {open && <Modal title={editing ? '编辑模型' : '添加模型'} eyebrow="连接观测" onClose={() => setOpen(false)} closeDisabled={saving} className="modal--model"><form onSubmit={save}>{error && <InlineNotice tone="error">{error}</InlineNotice>}<div className="form-grid">
      <Field label="配置名称"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="例如：主用模型" /></Field>
      <Field label="服务商预设"><select value={providerValue} onChange={(event) => { const value = event.target.value; if (value === 'custom') setForm({ ...form, provider: '' }); else setForm({ ...form, provider: value, base_url: presets[value].base_url, schema_type: presets[value].schema_type }); }}>{Object.keys(presets).map((name) => <option key={name}>{name}</option>)}<option value="custom">自定义</option></select></Field>
      {!presets[form.provider] && <Field label="自定义服务商" className="form-grid__wide"><input value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} required placeholder="服务商名称" /></Field>}
      <Field label="模型 ID" className="form-grid__wide"><input value={form.model_id} onChange={(event) => setForm({ ...form, model_id: event.target.value })} required placeholder="提供商的模型标识" /></Field>
      <Field label="API Base URL" hint="填写 /v1 级前缀；粘贴完整 endpoint 也可兼容" className="form-grid__wide"><input type="url" value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} required /></Field>
      <Field label="API Schema"><select value={form.schema_type} onChange={(event) => setForm({ ...form, schema_type: event.target.value as SchemaType })}><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option><option value="anthropic">Anthropic</option></select></Field>
      <Field label="推理强度"><select value={customReasoning ? 'custom' : form.reasoning_effort} onChange={(event) => { const value = event.target.value; setCustomReasoning(value === 'custom'); setForm({ ...form, reasoning_effort: value === 'custom' ? '' : value }); }}><option value="none">不指定</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">极高</option><option value="max">最大</option><option value="custom">自定义</option></select></Field>
      {customReasoning && <Field label="自定义推理强度" hint="填写服务商接受的级别值"><input value={form.reasoning_effort} onChange={(event) => setForm({ ...form, reasoning_effort: event.target.value })} required maxLength={32} placeholder="例如：minimal、ultra" /></Field>}
      <Field label="思考字段路径" hint={requiresReasoningField ? '填写服务商对应字段，例如 output_config.effort；按填写的级别值直接发送' : '留空使用协议默认字段；可自定义为 reasoning.effort 等路径'} className="form-grid__wide"><input value={form.reasoning_field} onChange={(event) => setForm({ ...form, reasoning_field: event.target.value })} required={requiresReasoningField} maxLength={128} placeholder="使用协议默认字段" /></Field>
      <Field label="API Key" hint={editing ? '留空保留原密钥，保存后不再回显' : '本地免密服务可留空'} className="form-grid__wide"><div className="input-with-icon"><KeyRound /><input type="password" value={form.api_key} onChange={(event) => setForm({ ...form, api_key: event.target.value })} autoComplete="new-password" placeholder={editing ? '不修改请留空' : '输入 API Key'} /></div></Field>
      <Field label="上下文窗口" hint="最小 4096 tokens"><input type="number" min={4096} step={1024} value={form.context_window} onChange={(event) => setForm({ ...form, context_window: Number(event.target.value) })} required /></Field>
      <Field label="最大输出 Tokens" hint="最小 256，默认 8192"><input type="number" min={256} step={256} value={form.max_output_tokens} onChange={(event) => setForm({ ...form, max_output_tokens: Number(event.target.value) })} required /></Field>
      <Field label="压缩阈值" hint="0.3～0.95，达到上下文比例后压缩"><input type="number" min={0.3} max={0.95} step={0.05} value={form.compression_threshold} onChange={(event) => setForm({ ...form, compression_threshold: Number(event.target.value) })} required /></Field>
      <Field label="图片能力"><label className="switch-row"><input type="checkbox" checked={form.supports_images} onChange={(event) => setForm({ ...form, supports_images: event.target.checked })} /><span className="switch" /><span>{form.supports_images ? '支持图片输入' : '仅文本输入'}</span></label></Field>
    </div><div className="modal__actions"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button type="submit" loading={saving}>{editing ? '保存配置' : '添加模型'}</Button></div></form></Modal>}
    {deleting && <ConfirmDialog title={`删除 ${deleting.name}？`} description="模型连接配置将被移除，此操作无法恢复。" loading={deleteSaving} onClose={() => setDeleting(null)} onConfirm={() => void remove()} />}
  </section>;
}
