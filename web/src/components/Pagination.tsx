import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import type { Pagination as PaginationData, Retention } from '../types';
import { Button } from './ui';
import './pagination.css';

interface PaginationProps {
  label: string;
  pagination: PaginationData | null;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function Pagination({ label, pagination, pageSize, loading, onPageChange, onPageSizeChange }: PaginationProps) {
  return <nav className="admin-pagination" aria-label={`${label}分页`} aria-busy={loading}>
    <span className="admin-pagination__summary" role="status">{loading ? '正在加载…' : pagination ? `${pagination.total_pages ? `第 ${pagination.page} / ${pagination.total_pages} 页` : '共 0 页'} · 共 ${pagination.total} 条` : '页码与条数待加载'}</span>
    <label className="admin-pagination__size">每页条数<select aria-label={`${label}每页条数`} value={pageSize} disabled={loading} onChange={event => onPageSizeChange(Number(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label>
    <div className="admin-pagination__actions">
      <Button type="button" variant="ghost" disabled={loading || !pagination || pagination.page <= 1} onClick={() => pagination && onPageChange(pagination.page - 1)}><ChevronLeft aria-hidden="true" />上一页</Button>
      <Button type="button" variant="ghost" disabled={loading || !pagination || pagination.page >= pagination.total_pages} onClick={() => pagination && onPageChange(pagination.page + 1)}>下一页<ChevronRight aria-hidden="true" /></Button>
    </div>
  </nav>;
}

export function RetentionHint({ retention, aggregateTotals = false }: { retention: Retention; aggregateTotals?: boolean }) {
  const hint = `明细保留 ${retention.days} 天，最多 ${retention.max_rows.toLocaleString('zh-CN')} 条；分页条数仅统计当前筛选下保留的明细。${aggregateTotals ? '汇总保留清理前的累计用量，汇总次数可能与分页条数不同。' : ''}`;
  return <span className="cache-hint" tabIndex={0} aria-label={hint} data-tooltip-touch="" data-tooltip={hint}><Info aria-hidden="true" /></span>;
}
