import { useCallback, useEffect, useState } from 'react';

export const EXPERIENCE_MODES = ['simple', 'guided', 'advanced'] as const;
export type ExperienceMode = (typeof EXPERIENCE_MODES)[number];

const STORAGE_KEY = 'wora:experience-mode';
const CHANGE_EVENT = 'wora:experience-mode-change';

export function isExperienceMode(value: unknown): value is ExperienceMode {
  return typeof value === 'string' && (EXPERIENCE_MODES as readonly string[]).includes(value);
}

export function readExperienceMode(): ExperienceMode {
  if (typeof window === 'undefined') return 'simple';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isExperienceMode(stored) ? stored : 'simple';
  } catch {
    return 'simple';
  }
}

export function useExperienceMode(): readonly [ExperienceMode, (next: ExperienceMode) => void] {
  const [mode, setModeState] = useState<ExperienceMode>(readExperienceMode);

  useEffect(() => {
    const sync = () => setModeState(readExperienceMode());
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const setMode = useCallback((next: ExperienceMode) => {
    setModeState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [mode, setMode] as const;
}
