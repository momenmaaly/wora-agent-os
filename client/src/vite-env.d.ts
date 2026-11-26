/// <reference types="vite/client" />

declare module 'three/examples/fonts/helvetiker_bold.typeface.json' {
  import type { FontData } from 'three/examples/jsm/loaders/FontLoader.js';
  const content: FontData;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_OS_API?: string;
  readonly VITE_SOCKET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
