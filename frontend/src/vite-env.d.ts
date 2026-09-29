/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_MAP_TILE_URL: string;
  readonly VITE_MAP_ATTRIBUTION: string;
  readonly VITE_PUBLIC_MAP_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
