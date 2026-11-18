export function WoraMark({ size = 31, showWord = true }: { size?: number; showWord?: boolean }) {
  return (
    <span className="wora-brand">
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <rect x="0.5" y="0.5" width="39" height="39" rx="9" fill="var(--button-bg)" />
        <path d="M8 13.2 13.2 26.8h4.2L22.8 14h-4.4l-3.2 8.2-3.1-9H8Z" fill="var(--button-ink)" />
        <path d="M18.4 14h4.4l3 8.2 3.5-9h4.1l-5.6 13.6h-4.2L18.4 14Z" fill="var(--button-ink)" />
        <path d="M18.4 14h4.4l-2.2 5.3-2.2-5.3Z" fill="var(--accent-quiet)" />
      </svg>
      {showWord && <span className="wora-word" dir="ltr"><b>wora<span>.</span></b></span>}
    </span>
  );
}
