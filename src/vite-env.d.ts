/// <reference types="vite/client" />

declare global {
  const __BUILD_TIME__: string;

  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        initDataUnsafe?: {
          user?: {
            id?: number;
          };
        };
      };
    };
  }
}

export {};
