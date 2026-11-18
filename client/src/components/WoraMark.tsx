export function WoraMark({ size = 32, showWord = true }: { size?: number; showWord?: boolean }) {
  return <span className="wora-brand" dir="ltr">
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M10 1h20l9 9v20l-9 9H10l-9-9V10Z" fill="var(--accent-wash)" stroke="var(--accent-line)" />
      <path d="M10 5H6v5m24-5h4v5M6 30v4h4m24-4v4h-4" stroke="var(--accent)" strokeWidth="1" opacity=".6" />
      <path d="M8 13h5l3 10 4-10 4 10 3-10h5l-6 15h-4l-2-5-2 5h-4z" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {showWord && <span className="wora-word"><strong>WORA</strong><span>// OS</span></span>}
  </span>;
}
