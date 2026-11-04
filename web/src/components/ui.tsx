import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  MoonStar,
  X,
} from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useLayoutEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils';

export function Brand({ compact = false, onClick }: { compact?: boolean; onClick?: () => void }) {
  const content = <>
    <span className="brand__sigil" aria-hidden="true"><MoonStar /></span>
    <span className="brand__words">
      <strong>秘域</strong>
      {!compact && <small>Mysterious Realm</small>}
    </span>
  </>;
  if (onClick) return <button type="button" className={cx('brand', 'brand--link', compact && 'brand--compact')} onClick={onClick} aria-label="返回模式选择" data-tooltip="返回模式选择">{content}</button>;
  return <div className={cx('brand', compact && 'brand--compact')}>{content}</div>;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx('button', `button--${variant}`, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoaderCircle className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  active?: boolean;
}

export function IconButton({ label, children, className, active, ...props }: IconButtonProps) {
  return (
    <button
      className={cx('icon-button', active && 'is-active', className)}
      aria-label={label}
      data-tooltip={label}
      {...props}
    >
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <label className={cx('field', className)}>
      <span className="field__label">{label}</span>
      {children}
      {(error || hint) && (
        <small className={cx('field__hint', error && 'field__hint--error')}>
          {error && <AlertCircle aria-hidden="true" />}{error || hint}
        </small>
      )}
    </label>
  );
}

interface ModalProps {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  closeDisabled?: boolean;
}

const modalStack: HTMLDivElement[] = [];
let restorePage: (() => void) | undefined;
const inertSnapshot = new Map<HTMLElement, boolean>();

function syncModalLayers() {
  const top = modalStack[modalStack.length - 1];
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || child.hasAttribute('data-tooltip-layer')) continue;
    if (!inertSnapshot.has(child)) inertSnapshot.set(child, child.inert);
    child.inert = child !== top;
  }
  modalStack.forEach((layer, index) => { layer.style.zIndex = String(100 + index); });
}

function lockModalPage() {
  const body = document.body;
  const root = document.documentElement;
  const x = window.scrollX;
  const y = window.scrollY;
  const properties = ['position', 'top', 'left', 'width', 'overflow', 'padding-right'] as const;
  const saved = properties.map((name) => [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)] as const);
  const rootOverflow = root.style.overflow;
  const gutter = Math.max(0, window.innerWidth - root.clientWidth);
  const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
  Object.assign(body.style, { position: 'fixed', top: `${-y}px`, left: `${-x}px`, width: '100%', overflow: 'hidden', paddingRight: `${padding + gutter}px` });
  root.style.overflow = 'hidden';
  return () => {
    saved.forEach(([name, value, priority]) => {
      if (value) body.style.setProperty(name, value, priority);
      else body.style.removeProperty(name);
    });
    root.style.overflow = rootOverflow;
    const behavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(x, y);
    root.style.scrollBehavior = behavior;
  };
}

export function Modal({ title, eyebrow, children, onClose, className, closeDisabled = false }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const disabledRef = useRef(closeDisabled);
  closeRef.current = onClose;
  disabledRef.current = closeDisabled;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const panel = panelRef.current;
    if (!layer || !panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!modalStack.length) restorePage = lockModalPage();
    modalStack.push(layer);
    syncModalLayers();
    const isTop = () => modalStack[modalStack.length - 1] === layer;
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
    panel.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!disabledRef.current) closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
      } else if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
        const bounds = last.getBoundingClientRect();
        const viewport = panel.getBoundingClientRect();
        const top = viewport.top + (panel.querySelector('header')?.offsetHeight ?? 0) + 12;
        if (bounds.bottom > viewport.bottom) panel.scrollTop += bounds.bottom - viewport.bottom + 12;
        else if (bounds.top < top) panel.scrollTop -= top - bounds.top;
      } else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
        panel.scrollTop = 0;
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTop() && !panel.contains(event.target as Node)) panel.focus({ preventScroll: true });
    };
    let touchX = 0;
    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => {
      touchX = event.touches[0]?.clientX ?? 0;
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!isTop() || event.touches.length !== 1) return;
      const next = event.touches[0];
      const dx = next.clientX - touchX;
      const dy = next.clientY - touchY;
      touchX = next.clientX;
      touchY = next.clientY;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const delta = horizontal ? dx : dy;
      let node = event.target instanceof Element ? (event.target instanceof HTMLElement ? event.target : event.target.parentElement) : null;
      while (node && panel.contains(node)) {
        const style = getComputedStyle(node);
        if (style.touchAction.includes('pan-x') && /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth) return;
        const overflow = horizontal ? style.overflowX : style.overflowY;
        const scroll = horizontal ? node.scrollLeft : node.scrollTop;
        const size = horizontal ? node.scrollWidth : node.scrollHeight;
        const viewport = horizontal ? node.clientWidth : node.clientHeight;
        if (/(auto|scroll)/.test(overflow) && size > viewport &&
          ((delta > 0 && scroll > 0) || (delta < 0 && scroll + viewport < size - 1))) return;
        node = node.parentElement;
      }
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    layer.addEventListener('touchstart', onTouchStart, { passive: true });
    layer.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
      layer.removeEventListener('touchstart', onTouchStart);
      layer.removeEventListener('touchmove', onTouchMove);
      const wasTop = isTop();
      modalStack.splice(modalStack.indexOf(layer), 1);
      layer.inert = inertSnapshot.get(layer) ?? false;
      inertSnapshot.delete(layer);
      if (modalStack.length) syncModalLayers();
      else {
        inertSnapshot.forEach((inert, element) => { element.inert = inert; });
        inertSnapshot.clear();
        restorePage?.();
        restorePage = undefined;
      }
      if (wasTop) {
        const target = previous?.isConnected && !previous.closest('[inert]') ? previous : modalStack[modalStack.length - 1]?.querySelector<HTMLElement>('[role="dialog"]');
        target?.focus({ preventScroll: true });
      }
    };
  }, []);

  return createPortal(
    <div ref={layerRef} className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && modalStack[modalStack.length - 1] === layerRef.current && !closeDisabled) onClose();
    }}>
      <div
        ref={panelRef}
        className={cx('modal', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal__header">
          <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2></div>
          <IconButton label="关闭" onClick={onClose} disabled={closeDisabled}><X /></IconButton>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '确认删除',
  loading,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} closeDisabled={loading} className="modal--small">
      <p className="modal__description">{description}</p>
      <div className="modal__actions">
        <Button variant="ghost" onClick={onClose} disabled={loading}>取消</Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

export function InlineNotice({ tone = 'info', children, className }: {
  tone?: 'info' | 'error' | 'success';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('notice', `notice--${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'error' ? <AlertCircle /> : tone === 'success' ? <CheckCircle2 /> : <MoonStar />}
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-state__icon">{icon}</span>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export interface ToastItem {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

export function ToastRegion({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <div className={cx('toast', `toast--${item.tone}`)} key={item.id}>
          {item.tone === 'success' ? <CheckCircle2 /> : item.tone === 'error' ? <AlertCircle /> : <MoonStar />}
          <span>{item.message}</span>
          <IconButton label="关闭提示" onClick={() => onDismiss(item.id)}><X /></IconButton>
        </div>
      ))}
    </div>
  );
}

export function LoadingBlock({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('loading-block', className)} aria-label="正在加载" {...props}><LoaderCircle className="spin" /></div>;
}
