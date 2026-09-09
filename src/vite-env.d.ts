/// <reference types="vite/client" />

declare global {
  const __BUILD_TIME__: string;

  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        onEvent?: (eventType: string, eventHandler: () => void) => void;
        offEvent?: (eventType: string, eventHandler: () => void) => void;
        initDataUnsafe?: {
          user?: {
            id?: number;
          };
        };
        HapticFeedback?: {
          notificationOccurred: (type: "error" | "success" | "warning") => void;
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
        };
        [key: string]: any;
      };
    };
  }
}

export {};
