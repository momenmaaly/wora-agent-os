/**
 * WoraMark — editorial wordmark + monogram
 * Not AI-generic: geometric, ink + brass, Arabic ورا subtly integrated
 */
export function WoraMark({ size=36, showWord=true }: { size?:number; showWord?:boolean }){
  return (
    <div className="flex items-center gap-3" dir="ltr">
      <div className="relative flex items-center justify-center rounded-[12px] bg-[#0B0F19] shadow-[0_6px_20px_rgba(11,15,25,.18)]" style={{width:size, height:size}}>
        {/* monogram W */}
        <svg width={size*0.62} height={size*0.62} viewBox="0 0 32 32" fill="none" aria-hidden>
          <path d="M6 8 L11 24 L16 12 L21 24 L26 8" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="16" cy="26.5" r="1.6" fill="#CBA36B"/>
        </svg>
        <span className="absolute -bottom-1 -right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[#CBA36B] text-[8px] font-black text-[#0B0F19]">و</span>
      </div>
      {showWord && (
        <div className="flex flex-col leading-none">
          <span className="font-display text-[18px] font-[900] tracking-[-0.02em] text-[#0B0F19] dark:text-white">WORA</span>
          <span className="text-[10px] font-[700] tracking-[0.18em] text-stone-500">نظام تشغيل شركتك</span>
        </div>
      )}
    </div>
  );
}
