import type { AlertFeedStatus } from "../domain/types.js";
import { createLogger } from "./logger.js";

const log = createLogger("failure-monitor");

export type IncidentSeverity = "warning" | "critical";
export type IncidentStatus = "OPEN" | "RESOLVED";

export interface TechnicalIncident {
  key: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  detail: string;
  openedAt: number;
  lastSeenAt: number;
  resolvedAt?: number;
  occurrences: number;
}

export interface FailureEvaluationInput {
  now?: number;
  uptimeSeconds: number;
  memoryMb: number;
  dbOk: boolean;
  dbLatencyMs?: number;
  dbError?: string;
  alertStatus: AlertFeedStatus;
  alertConsecutiveFailures: number;
  alertError?: string | null;
  osintTotalChannels: number;
  osintRespondingChannels: number;
}

export interface MonitoringSnapshot {
  status: "OK" | "DEGRADED" | "CRITICAL";
  activeIncidentsCount: number;
  activeIncidents: TechnicalIncident[];
  recentIncidentsCount: number;
  runtimeErrorsCount: number;
  lastEvaluatedAt: number | null;
}

export interface AlertDispatcher {
  send(event: { action: "OPEN" | "RESOLVED"; incident: TechnicalIncident }): Promise<void>;
}

const MAX_HISTORY = 50;
const NOTIFY_COOLDOWN_MS = 15 * 60 * 1000;

export class TechnicalFailureMonitor {
  private readonly active = new Map<string, TechnicalIncident>();
  private readonly history: TechnicalIncident[] = [];
  private readonly lastNotifiedAt = new Map<string, number>();
  private runtimeErrorsCount = 0;
  private lastEvaluatedAt: number | null = null;
  private dispatcher?: AlertDispatcher;

  constructor(dispatcher?: AlertDispatcher) {
    this.dispatcher = dispatcher;
  }

  setDispatcher(dispatcher: AlertDispatcher): void {
    this.dispatcher = dispatcher;
  }

  evaluate(input: FailureEvaluationInput): MonitoringSnapshot {
    const now = input.now ?? Date.now();
    this.lastEvaluatedAt = now;

    // 1. Database connectivity
    this.reconcile(
      "db_unavailable",
      !input.dbOk,
      "critical",
      "Neon PostgreSQL unavailable",
      input.dbError || "Database ping failed",
      now
    );

    // 2. Database latency
    this.reconcile(
      "db_high_latency",
      input.dbOk && typeof input.dbLatencyMs === "number" && input.dbLatencyMs > 3000,
      "warning",
      "Neon PostgreSQL high latency",
      `DB latency ${input.dbLatencyMs ?? 0}ms exceeds 3000ms threshold`,
      now
    );

    // 3. Official civil alert feed outage (grace period 60s on fresh cold start)
    const alertDown =
      input.alertStatus === "stale" ||
      (input.alertStatus === "unavailable" && input.uptimeSeconds >= 60);
    this.reconcile(
      "official_alerts_outage",
      alertDown,
      input.alertStatus === "stale" || input.alertConsecutiveFailures >= 3 ? "critical" : "warning",
      "Official air-raid alert source unavailable",
      `status=${input.alertStatus}, failures=${input.alertConsecutiveFailures}${input.alertError ? `, error=${input.alertError}` : ""}`,
      now
    );

    // 4. OSINT channel majority degradation (after 45s initial warmup)
    const osintDegraded =
      input.uptimeSeconds >= 45 &&
      input.osintTotalChannels > 0 &&
      input.osintRespondingChannels / input.osintTotalChannels < 0.5;
    this.reconcile(
      "osint_channels_degraded",
      osintDegraded,
      input.osintRespondingChannels === 0 ? "critical" : "warning",
      "OSINT air-defense channels degraded",
      `${input.osintRespondingChannels}/${input.osintTotalChannels} channels responding`,
      now
    );

    // 5. Memory pressure (Render free tier safety margin)
    this.reconcile(
      "memory_pressure",
      input.memoryMb >= 165,
      input.memoryMb >= 220 ? "critical" : "warning",
      "Worker RSS memory pressure",
      `RSS=${input.memoryMb}MB (warning >=165MB, critical >=220MB)`,
      now
    );

    return this.getSnapshot();
  }

  recordRuntimeError(component: string, err: unknown): void {
    this.runtimeErrorsCount += 1;
    const message = err instanceof Error ? err.message : String(err);
    log.error({ component, error: message }, "Technical runtime error captured");
  }

  private reconcile(
    key: string,
    triggered: boolean,
    severity: IncidentSeverity,
    title: string,
    detail: string,
    now: number
  ): void {
    const existing = this.active.get(key);

    if (triggered) {
      if (!existing) {
        const incident: TechnicalIncident = {
          key,
          severity,
          status: "OPEN",
          title,
          detail,
          openedAt: now,
          lastSeenAt: now,
          occurrences: 1
        };
        this.active.set(key, incident);
        this.pushHistory(incident);
        log.warn({ incident }, "Technical incident opened");
        this.notifyIfAllowed("OPEN", incident, now);
      } else {
        existing.severity = severity;
        existing.detail = detail;
        existing.lastSeenAt = now;
        existing.occurrences += 1;
      }
      return;
    }

    if (existing) {
      existing.status = "RESOLVED";
      existing.resolvedAt = now;
      existing.lastSeenAt = now;
      this.active.delete(key);
      this.pushHistory({ ...existing });
      log.info({ incident: existing }, "Technical incident resolved");
      this.notifyIfAllowed("RESOLVED", existing, now);
    }
  }

  private pushHistory(incident: TechnicalIncident): void {
    this.history.unshift({ ...incident });
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }
  }

  private notifyIfAllowed(action: "OPEN" | "RESOLVED", incident: TechnicalIncident, now: number): void {
    if (!this.dispatcher) return;
    if (action === "OPEN") {
      const last = this.lastNotifiedAt.get(incident.key) ?? 0;
      if (now - last < NOTIFY_COOLDOWN_MS) return;
      this.lastNotifiedAt.set(incident.key, now);
    }
    void this.dispatcher.send({ action, incident }).catch((err) => {
      log.warn({ err: err instanceof Error ? err.message : String(err), key: incident.key }, "Failure alert dispatch failed");
    });
  }

  getSnapshot(): MonitoringSnapshot {
    const activeIncidents = Array.from(this.active.values());
    const hasCritical = activeIncidents.some((i) => i.severity === "critical");
    const status = hasCritical ? "CRITICAL" : activeIncidents.length > 0 ? "DEGRADED" : "OK";
    return {
      status,
      activeIncidentsCount: activeIncidents.length,
      activeIncidents,
      recentIncidentsCount: this.history.length,
      runtimeErrorsCount: this.runtimeErrorsCount,
      lastEvaluatedAt: this.lastEvaluatedAt
    };
  }

  getRecentHistory(limit = 20): TechnicalIncident[] {
    return this.history.slice(0, Math.min(MAX_HISTORY, Math.max(1, limit)));
  }
}

/**
 * Default free-tier technical failure alert dispatcher:
 * - Optional ALERT_WEBHOOK_URL (Discord / Slack / ntfy / custom JSON webhook)
 * - Optional Telegram admin notification if ALERT_TELEGRAM_ENABLED=true + BOT_TOKEN + ADMIN_ID
 */
export const createDefaultAlertDispatcher = (): AlertDispatcher => ({
  async send({ action, incident }) {
    const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();
    const emoji = action === "RESOLVED" ? "✅" : incident.severity === "critical" ? "🚨" : "⚠️";
    const text = `${emoji} [Eye Radar ${action}] ${incident.title}\nSeverity: ${incident.severity.toUpperCase()}\nDetail: ${incident.detail}`;

    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          content: text,
          service: "eye-radar",
          action,
          incident
        }),
        signal: AbortSignal.timeout(5000)
      });
    }

    const tgAlertEnabled = process.env.ALERT_TELEGRAM_ENABLED === "true";
    const botToken = process.env.BOT_TOKEN?.trim();
    const adminChatId = (process.env.ADMIN_ALERT_CHAT_ID || process.env.ADMIN_ID || "").trim();
    if (tgAlertEnabled && botToken && adminChatId && /^\d+$/.test(adminChatId)) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: adminChatId,
          text
        }),
        signal: AbortSignal.timeout(5000)
      });
    }
  }
});

export const failureMonitor = new TechnicalFailureMonitor(createDefaultAlertDispatcher());
