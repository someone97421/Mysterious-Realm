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
  useEffect,
  useId,
  useRef,
} from 'react';
import { cx } from '../utils';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cx('brand', compact && 'brand--compact')}>
      <span className="brand__sigil" aria-hidden="true"><MoonStar /></span>
      <span className="brand__words">
        <strong>星帷塔罗</strong>
        {!compact && <small>ASTRAL VEIL TAROT</small>}
      </span>
    </div>
  );
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
      className={cx('icon-button has-tooltip', active && 'is-active', className)}
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

export function Modal({ title, eyebrow, children, onClose, className, closeDisabled = false }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const disabledRef = useRef(closeDisabled);
  closeRef.current = onClose;
  disabledRef.current = closeDisabled;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex="0"]',
      );
      (first ?? panelRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disabledRef.current) closeRef.current();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex="0"]',
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !closeDisabled) onClose();
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
    </div>
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
