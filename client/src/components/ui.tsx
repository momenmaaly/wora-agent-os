import { useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Info, X, type LucideIcon } from 'lucide-react';

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
  return <div className="empty-state"><IconTile icon={icon} /><strong>{title}</strong>{children && <div>{children}</div>}</div>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="notice"><Info size={17} aria-hidden="true" /><div>{children}</div></div>;
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
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </header>
        <div className="dialog-body hq-scroll">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </dialog>
  );
}
