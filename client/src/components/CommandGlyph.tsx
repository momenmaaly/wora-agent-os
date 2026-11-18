const glyphs = {
  mesh: 'M12 2.5 21 7v10l-9 4.5L3 17V7ZM3 7l9 5 9-5m-9 5v9.5m0-19v5m0 4.5-5 2.8m5-2.8 5 2.8',
  agents: 'M8 4h8l4 4v8l-4 4H8l-4-4V8Zm1 5h6v6H9Zm3-8v3m0 16v3M1 12h3m16 0h3',
  pulse: 'M2 13h5l3-8 4 14 3-6h5M2 8V5h3m14 14h3v-3',
  skill: 'm12 3 3 4 5 1 1 5-4 3-1 5H8l-1-5-4-3 1-5 5-1zm0 5v8m-4-4h8',
  task: 'M7 3h10l4 4v14H3V3h4m10 0v5h4M7 9l2 2 3-4m2 7h4m-4 4h4m-7-4H7m4 4H7',
  channel: 'M2.5 12 8 6.5l5.5 5.5L8 17.5zm11 0 4-4L22 12l-4.5 4zm-8-8h4m5 16h4',
  terminal: 'M5 4h14l3 3v10l-3 3H2V7zm2 4 4 4-4 4m6 0h5',
} as const;

export function CommandGlyph({ kind, size = 21, className }: { kind: keyof typeof glyphs; size?: number; className?: string }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"><path d={glyphs[kind]} /></svg>;
}
