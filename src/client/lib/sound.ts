class RadarSoundEngine {
  private ctx: AudioContext | null = null;
  private soundEnabled = true;
  private lastBeep = 0;

  constructor() {
    this.soundEnabled = localStorage.getItem("eye-radar-sound") !== "false";
  }

  isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  toggleSound(): boolean {
    this.soundEnabled = !this.soundEnabled;
    localStorage.setItem("eye-radar-sound", String(this.soundEnabled));
    return this.soundEnabled;
  }

  private getAudioContext(): AudioContext | null {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playRadarPing(): void {
    if (!this.soundEnabled) return;

    const now = Date.now();
    // Rate limit beeps to at most once every 6 seconds
    if (now - this.lastBeep < 6000) return;
    this.lastBeep = now;

    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);

      // Trigger Telegram webapp vibration if available
      if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred("warning");
      }
    } catch {
      // Ignore audio failure if user hasn't interacted
    }
  }
}

export const soundEngine = new RadarSoundEngine();
