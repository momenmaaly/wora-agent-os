/** Lightweight WebGL capability check used before mounting the optional 3D office. */
export function supportsWebGL(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    if (!context) return false;
    const lose = (context as WebGLRenderingContext).getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Conservative adaptive quality based on viewport and device hints. */
export function recommended3DQuality(): 'low' | 'high' {
  if (typeof window === 'undefined') return 'low';
  const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return window.innerWidth < 720 || cores <= 4 || memory <= 2 ? 'low' : 'high';
}
