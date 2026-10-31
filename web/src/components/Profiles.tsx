import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, ApiError, jsonBody } from '../api';
import type { Location, Profile, TimeAccuracy } from '../types';
import { Button, Field, IconButton, InlineNotice, Modal } from './ui';

export const accuracyLabels: Record<TimeAccuracy, string> = { exact: '准确时间', approximate: '大约时间', range: '时间范围', unknown: '时间未知' };
export function ProfileSummary({ profile, onClose, onRemove }: { profile: Profile; onClose: () => void; onRemove?: () => void }) {
  return <Modal title={`${profile.avatar || '✦'} ${profile.name}`} eyebrow="人物资料" onClose={onClose} className="modal--small">
    <dl className="profile-summary"><dt>出生日期</dt><dd>{profile.birth_date || '未知'}</dd><dt>出生时间</dt><dd>{accuracyLabels[profile.time_accuracy]} {profile.birth_time}{profile.time_accuracy === 'range' && profile.time_end ? ` — ${profile.time_end}` : ''}</dd><dt>出生地点</dt><dd>{profile.location_name || '未知'}</dd><dt>时区</dt><dd>{profile.timezone || '未知'}</dd>{profile.notes && <><dt>备注</dt><dd>{profile.notes}</dd></>}</dl>
    {onRemove && <Button variant="secondary" onClick={onRemove}>移除此引用</Button>}
  </Modal>;
}
const blank = (): Profile => ({ id: '', name: '', avatar: '✦', color: '#d6bd7d', birth_date: null, birth_time: null, time_accuracy: 'unknown', time_end: null, location_name: null, latitude: null, longitude: null, timezone: null, notes: '', version: 0, created_at: '', updated_at: '' });
export function Profiles({ profiles, onChange, onClose }: { profiles: Profile[]; onChange: (profiles: Profile[]) => void; onClose: () => void }) {
  const [editing, setEditing] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    if (!deleting) return;
    setBusy(true); setError('');
    try { await api(`/api/profiles/${deleting.id}`, { method: 'DELETE' }); onChange(profiles.filter(p => p.id !== deleting.id)); setDeleting(null); }
    catch { setError('人物删除失败，请重试'); } finally { setBusy(false); }
  };
  return <Modal title="我的人物" eyebrow="星轨档案" onClose={onClose}>
    <Button onClick={() => setEditing(blank())}><Plus />新建人物</Button>
    {error && <InlineNotice tone="error">{error}</InlineNotice>}
    <div className="profile-list">{profiles.map(p => <article className="profile-card" key={p.id}><span className="profile-avatar" style={{ color: p.color }}>{p.avatar || '✦'}</span><div><strong>{p.name}</strong><small>{p.birth_date || '生日未知'} · {p.location_name || '地点未知'}</small></div><IconButton label={`编辑${p.name}`} onClick={() => setEditing(p)}><Pencil /></IconButton><IconButton label={`删除${p.name}`} onClick={() => { setError(''); setDeleting(p); }}><Trash2 /></IconButton></article>)}</div>
    {!profiles.length && <small className="hint">尚无人物，先记下一段出生信息。</small>}
    {editing && <ProfileForm initial={editing} onClose={() => setEditing(null)} onSaved={p => { onChange(editing.id ? profiles.map(old => old.id === p.id ? p : old) : [...profiles, p]); setEditing(null); }} />}
    {deleting && <Modal title={`删除「${deleting.name}」？`} onClose={() => !busy && setDeleting(null)} closeDisabled={busy}><small className="hint">历史对话中的人物快照会保留。</small>{error && <InlineNotice tone="error">{error}</InlineNotice>}<Button variant="danger" loading={busy} onClick={() => void remove()}>确认删除</Button></Modal>}
  </Modal>;
}
function ProfileForm({ initial, onSaved, onClose }: { initial: Profile; onSaved: (p: Profile) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const [query, setQuery] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchHint, setSearchHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const update = (patch: Partial<Profile>) => { setValue(v => ({ ...v, ...patch })); setFieldErrors({}); setError(''); };
  useEffect(() => {
    setLocations([]); setSearchHint('');
    if (!query.trim()) { setSearching(false); return; }
    const controller = new AbortController(); setSearching(true);
    const timer = window.setTimeout(() => {
      api<{ locations: Location[]; message?: string }>(`/api/locations?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then(result => { setLocations(result.locations); setSearchHint(result.locations.length ? '' : '未找到地点，可保留未知'); })
        .catch(() => { if (!controller.signal.aborted) setSearchHint('地点搜索暂不可用，请重试'); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 350);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setError('');
    const issues: Record<string, string> = {};
    if (value.time_accuracy !== 'unknown' && !value.birth_time) issues.birth_time = '请填写出生时间';
    if (value.time_accuracy === 'range') {
      if (!value.time_end) issues.time_end = '请填写结束时间';
      else if (value.birth_time && value.time_end < value.birth_time) issues.time_end = '结束时间不能早于开始时间';
    }
    if (value.location_name && [...value.location_name].length > 160) issues.location_name = '地点名称限 160 字，请重新选择';
    if (value.timezone && value.timezone.length > 64) issues.timezone = '地点时区限 64 字，请重新选择';
    setFieldErrors(issues); if (Object.keys(issues).length) return;
    setBusy(true);
    const { id, version, created_at, updated_at, ...payload } = value;
    void version; void created_at; void updated_at;
    try { onSaved(await api<Profile>(id ? `/api/profiles/${id}` : '/api/profiles', { method: id ? 'PUT' : 'POST', body: jsonBody({ ...payload, name: payload.name.trim(), birth_time: payload.time_accuracy === 'unknown' ? null : payload.birth_time, time_end: payload.time_accuracy === 'range' ? payload.time_end : null }) })); }
    catch (reason) { if (reason instanceof ApiError && reason.status === 422) { setFieldErrors(reason.fieldErrors); setError(Object.keys(reason.fieldErrors).length ? '请检查标记的资料' : '资料格式有误，请核对出生日期、时间和地点'); } else setError('人物保存失败，请稍后重试'); } finally { setBusy(false); }
  };
  return <Modal title={initial.id ? '编辑人物' : '新建人物'} onClose={onClose} closeDisabled={busy}>
    <form onSubmit={save}>
      <div className="form-grid">
        <Field label="名字" error={fieldErrors.name}><input required maxLength={80} value={value.name} onChange={e => update({ name: e.target.value })} /></Field>
        <Field label="头像符号" error={fieldErrors.avatar}><input maxLength={32} value={value.avatar} onChange={e => update({ avatar: e.target.value })} /></Field>
        <Field label="人物颜色" error={fieldErrors.color}><input type="color" value={value.color} onChange={e => update({ color: e.target.value })} /></Field>
        <Field label="出生日期" hint="留空为未知" error={fieldErrors.birth_date}><input type="date" value={value.birth_date || ''} onChange={e => update({ birth_date: e.target.value || null })} /></Field>
        <Field label="时间精度" error={fieldErrors.time_accuracy}><select value={value.time_accuracy} onChange={e => update({ time_accuracy: e.target.value as TimeAccuracy })}>{Object.entries(accuracyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        {value.time_accuracy !== 'unknown' && <Field label={value.time_accuracy === 'range' ? '开始时间' : '出生时间'} error={fieldErrors.birth_time}><input required type="time" value={value.birth_time || ''} onChange={e => update({ birth_time: e.target.value || null })} /></Field>}
        {value.time_accuracy === 'range' && <Field label="结束时间" error={fieldErrors.time_end}><input required type="time" min={value.birth_time || undefined} value={value.time_end || ''} onChange={e => update({ time_end: e.target.value || null })} /></Field>}
        <Field label="搜索出生城市" className="form-grid__wide" error={fieldErrors.location_name || fieldErrors.timezone || fieldErrors.latitude || fieldErrors.longitude} hint={searching ? '正在查询…' : searchHint || '选择查询结果以保存坐标'}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="输入城市名称" autoComplete="off" /></Field>
        {!!locations.length && <div className="location-results form-grid__wide">{locations.map((loc, index) => <button type="button" key={`${loc.name}-${index}`} onClick={() => { update({ location_name: loc.name, latitude: loc.latitude, longitude: loc.longitude, timezone: loc.timezone }); setQuery(''); }}>{loc.name}<small>{loc.timezone || '时区未知'}</small></button>)}</div>}
        <div className="selected-location form-grid__wide"><span>{value.location_name || '出生地点未知'}</span>{value.location_name && <Button type="button" variant="ghost" onClick={() => update({ location_name: null, latitude: null, longitude: null, timezone: null })}>设为未知</Button>}</div>
        <Field label="备注" className="form-grid__wide" error={fieldErrors.notes}><textarea rows={3} maxLength={5000} value={value.notes} onChange={e => update({ notes: e.target.value })} /></Field>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <div className="modal__actions"><Button type="button" variant="ghost" onClick={onClose} disabled={busy}>取消</Button><Button loading={busy} disabled={!value.name.trim()}>保存人物</Button></div>
    </form>
  </Modal>;
}
