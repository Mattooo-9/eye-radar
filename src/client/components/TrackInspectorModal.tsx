import { useEffect, useState } from "react";

interface ProvenanceEntry {
  source: string;
  sourceFamily: string;
  observedAt: number;
  receivedAt: number;
  processedAt: number;
  latencyMs: number;
  confidence: number;
  evidence: string[];
  provenanceStr?: string;
  isSynthetic?: boolean;
}

interface TrackDiagnosticData {
  id: string;
  lifecycle: string;
  hitsCount: number;
  firstSeen: number;
  lastMeasurementTime: number;
  ageSec: number;
  isSynthetic: boolean;
  classification: {
    type: string;
    model?: string;
    propulsion?: string;
    confidence: number;
    evidence: string[];
    evidenceFamilies: string[];
  };
  kinematics: {
    estimated: {
      lat: number;
      lon: number;
      speedKmh: number;
      speedMs: number;
      heading: number;
      altitudeM?: number;
    };
    measured: {
      lat?: number;
      lon?: number;
      speedKmh?: number | null;
      altitudeM?: number;
      heading?: number;
      deltaFromEstimatedMeters?: number | null;
    };
    uncertaintyRadiusMeters?: number;
  };
  filter: {
    immActiveModel: "CV" | "CT";
    cvProbability: number;
    ctProbability: number;
    covLat?: number;
    covLon?: number;
    lastMahalanobisDistance?: number;
  };
  measuredHistory: Array<[lat: number, lon: number, timestamp: number]>;
  provenanceChain: ProvenanceEntry[];
}

interface TrackInspectorModalProps {
  targetId: string;
  onClose: () => void;
}

export const TrackInspectorModal = ({ targetId, onClose }: TrackInspectorModalProps) => {
  const [data, setData] = useState<TrackDiagnosticData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const fetchDiagnostic = async () => {
      try {
        const res = await fetch(`/api/tracks/${encodeURIComponent(targetId)}/diagnostic`);
        if (!res.ok) {
          throw new Error(`Track diagnostic unavailable (${res.status})`);
        }
        const json = (await res.json()) as TrackDiagnosticData;
        if (active) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    void fetchDiagnostic();
    const interval = setInterval(fetchDiagnostic, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [targetId]);

  return (
    <div className="target-card-overlay" onClick={onClose}>
      <div
        className="target-card target-card-extended diagnostic-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "600px", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div className="target-card-header">
          <div>
            <div className="target-badge-row">
              <span className="target-badge" style={{ background: "#0284c7" }}>
                🔬 ДІАГНОСТИКА ТРЕКУ
              </span>
              <span
                className="altitude-pill"
                style={{
                  background: data?.lifecycle === "CONFIRMED" ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.2)",
                  color: data?.lifecycle === "CONFIRMED" ? "#34d399" : "#fbbf24",
                  borderColor: data?.lifecycle === "CONFIRMED" ? "#10b981" : "#f59e0b"
                }}
              >
                {data?.lifecycle ?? "TRACKING"}
              </span>
            </div>
            <h3 className="target-model-title">{data?.classification.model ?? targetId}</h3>
            <span className="target-category-sub">
              ID: {targetId} • Вік треку: {data?.ageSec ?? 0} с • Замірів: {data?.hitsCount ?? 1}
            </span>
          </div>
          <button className="close-btn" onClick={onClose} title="Закрити">✕</button>
        </div>

        {loading && <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8" }}>Завантаження телеметрії...</div>}
        {error && <div style={{ padding: "24px", textAlign: "center", color: "#f87171" }}>{error}</div>}

        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "12px" }}>
            {/* Kinematic Measurement vs Estimation */}
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(56, 189, 248, 0.2)", borderRadius: "8px", padding: "12px" }}>
              <div style={{ fontSize: "11px", fontWeight: 800, color: "#38bdf8", marginBottom: "8px", textTransform: "uppercase" }}>
                📐 Вимірювання (Measured) проти Оцінки (Estimated)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
                <div>
                  <span style={{ color: "#94a3b8" }}>Позиція (Оцінена):</span>
                  <div style={{ color: "#f8fafc", fontWeight: 700 }}>
                    {data.kinematics.estimated.lat.toFixed(5)}°, {data.kinematics.estimated.lon.toFixed(5)}°
                  </div>
                </div>
                <div>
                  <span style={{ color: "#94a3b8" }}>Сенсор (Виміряно):</span>
                  <div style={{ color: "#38bdf8", fontWeight: 700 }}>
                    {data.kinematics.measured.lat !== undefined
                      ? `${data.kinematics.measured.lat.toFixed(5)}°, ${data.kinematics.measured.lon?.toFixed(5)}°`
                      : "—"}
                  </div>
                </div>
                <div>
                  <span style={{ color: "#94a3b8" }}>Швидкість:</span>
                  <div style={{ color: "#f8fafc", fontWeight: 700 }}>
                    {data.kinematics.estimated.speedKmh} км/год {data.kinematics.measured.speedKmh ? `(сенсор: ${data.kinematics.measured.speedKmh})` : "(оцінка IMM)"}
                  </div>
                </div>
                <div>
                  <span style={{ color: "#94a3b8" }}>Невизначеність (σ):</span>
                  <div style={{ color: "#f8fafc", fontWeight: 700 }}>
                    ±{data.kinematics.uncertaintyRadiusMeters ?? 250} м
                    {data.kinematics.measured.deltaFromEstimatedMeters !== null && ` (дельта: ${data.kinematics.measured.deltaFromEstimatedMeters} м)`}
                  </div>
                </div>
              </div>
            </div>

            {/* IMM Filter Mode Probabilities */}
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(56, 189, 248, 0.2)", borderRadius: "8px", padding: "12px" }}>
              <div style={{ fontSize: "11px", fontWeight: 800, color: "#38bdf8", marginBottom: "8px", textTransform: "uppercase" }}>
                🔄 IMM-Фільтр кінематики (Active: {data.filter.immActiveModel})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: "#cbd5e1" }}>
                    <span>Рівномірний прямолінійний політ (CV):</span>
                    <strong>{Math.round(data.filter.cvProbability * 100)}%</strong>
                  </div>
                  <div style={{ height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", overflow: "hidden", marginTop: "2px" }}>
                    <div style={{ width: `${data.filter.cvProbability * 100}%`, height: "100%", background: "#38bdf8" }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: "#cbd5e1" }}>
                    <span>Маневр / Розворот (CT):</span>
                    <strong>{Math.round(data.filter.ctProbability * 100)}%</strong>
                  </div>
                  <div style={{ height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", overflow: "hidden", marginTop: "2px" }}>
                    <div style={{ width: `${data.filter.ctProbability * 100}%`, height: "100%", background: "#f59e0b" }} />
                  </div>
                </div>

                {data.filter.lastMahalanobisDistance !== undefined && (
                  <div style={{ fontSize: "10.5px", color: "#94a3b8", marginTop: "4px" }}>
                    Відстань Махаланобіса (Gating): <strong style={{ color: "#38bdf8" }}>{data.filter.lastMahalanobisDistance.toFixed(2)}</strong> (поріг χ²: 9.21)
                  </div>
                )}
              </div>
            </div>

            {/* Provenance Chain */}
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(56, 189, 248, 0.2)", borderRadius: "8px", padding: "12px" }}>
              <div style={{ fontSize: "11px", fontWeight: 800, color: "#38bdf8", marginBottom: "8px", textTransform: "uppercase" }}>
                🔗 Ланцюг походження (Provenance Chain)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
                {data.provenanceChain.map((entry, idx) => {
                  const timeStr = new Date(entry.observedAt).toLocaleTimeString("uk-UA", { hour12: false });
                  return (
                    <div
                      key={idx}
                      style={{
                        background: "rgba(30, 41, 59, 0.6)",
                        padding: "6px 8px",
                        borderRadius: "5px",
                        fontSize: "10px",
                        borderLeft: "2px solid #38bdf8"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", color: "#f8fafc", fontWeight: 700 }}>
                        <span>Джерело: {entry.source} ({entry.sourceFamily})</span>
                        <span style={{ color: "#94a3b8" }}>{timeStr} • Лаг: {entry.latencyMs}мс</span>
                      </div>
                      {entry.evidence.length > 0 && (
                        <div style={{ color: "#94a3b8", marginTop: "2px" }}>
                          Ознаки: {entry.evidence.join(", ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
