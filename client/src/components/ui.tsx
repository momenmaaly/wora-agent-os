import { useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Info, LoaderCircle, ShieldAlert, X, type LucideIcon } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export function Button({
  variant = 'secondary', size = 'regular', loading = false, icon: Icon, children, className = '', disabled, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'regular' | 'small';
  loading?: boolean;
  icon?: LucideIcon;
}) {
  return <button
    type="button"
    className={`button ${variant} ${size === 'small' ? 'small' : ''} ${loading ? 'is-loading' : ''} ${className}`.trim()}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...props}
  >
    {loading ? <LoaderCircle size={size === 'small' ? 13 : 16} aria-hidden="true" /> : Icon ? <Icon size={size === 'small' ? 13 : 16} aria-hidden="true" /> : null}
    {children}
  </button>;
}

export function StatusBadge({ children, tone = 'neutral', dot = false, className = '' }: {
  children: ReactNode; tone?: BadgeTone; dot?: boolean; className?: string;
}) {
  return <span className={`status-badge status-badge-${tone} ${className}`.trim()}>
    {dot && <span className="status-dot" aria-hidden="true" />}
    {children}
  </span>;
}

export function RiskBadge({ risk, label }: { risk: string; label?: string }) {
  const normalized = risk === 'high' ? 'high' : risk === 'medium' ? 'medium' : 'low';
  const text = label ?? (normalized === 'high' ? 'High risk' : normalized === 'medium' ? 'Medium risk' : 'Low risk');
  return <span className="risk-badge" data-risk={normalized}><span className="status-dot" aria-hidden="true" />{text}</span>;
}

export function StateMessage({ variant = 'empty', title, children, icon: Icon }: {
  variant?: 'loading' | 'empty' | 'error' | 'success' | 'warning';
  title?: string;
  children?: ReactNode;
  icon?: LucideIcon;
}) {
  const Fallback = variant === 'loading' ? LoaderCircle : variant === 'success' ? CheckCircle2 : variant === 'error' ? CircleAlert : variant === 'warning' ? ShieldAlert : Info;
  const Glyph = Icon ?? Fallback;
  return <div className={`state-message ${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
    <Glyph size={17} className={variant === 'loading' ? 'os-spin' : undefined} aria-hidden="true" />
    <div>{title && <strong>{title}</strong>}{children}</div>
  </div>;
}

export function SegmentedControl({ items, value, onChange, ariaLabel }: {
  items: Array<{ id: string; label: string; icon?: LucideIcon; count?: number }>;
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  return <div className="os-tabs" role="tablist" aria-label={ariaLabel}>
    {items.map((item) => <button key={item.id} type="button" role="tab" aria-selected={value === item.id} className={`os-tab ${value === item.id ? 'is-active' : ''}`} onClick={() => onChange(item.id)}>
      {item.icon && <item.icon size={15} aria-hidden="true" />}
      {item.label}
      {item.count !== undefined && <span className="badge">{item.count}</span>}
    </button>)}
  </div>;
}

export function IconButton({ icon: Icon, label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}><Icon size={18} aria-hidden="true" /></button>;
}

export function IconTile({ icon: Icon, tone = 'violet' }: { icon: LucideIcon; tone?: 'violet' | 'cyan' | 'mint' | 'gold' }) {
  return <span className={`icon-tile tone-${tone}`}><Icon size={19} strokeWidth={1.7} aria-hidden="true" /></span>;
}

export function PageHeader({ icon, eyebrow, title, description, action }: { icon: LucideIcon; eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow"><IconTile icon={icon} />{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-heading-actions">{action}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return <div className="empty-state" role="status"><IconTile icon={icon} /><strong>{title}</strong>{children && <div>{children}</div>}</div>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'warning' | 'error' }) {
  return <div className={`notice ${tone}`}><Info size={17} aria-hidden="true" /><div>{children}</div></div>;
}

export function Dialog({ title, description, icon, onClose, children, footer, variant = 'center', className = '' }: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'center' | 'drawer' | 'navigation' | 'search';
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { t } = useI18n();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`ui-dialog dialog-${variant} ${className}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="dialog-surface">
        <header className={`dialog-heading ${variant === 'navigation' ? 'dialog-nav-heading' : ''}`}>
          {icon && <IconTile icon={icon} />}
          <div>
            <h2 id={`${id}-title`}>{title}</h2>
            {description && <p id={`${id}-description`}>{description}</p>}
          </div>
          <IconButton icon={X} label={t('app.close')} onClick={onClose} />
        </header>
        <div className="dialog-body hq-scroll">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </dialog>
  );
}
