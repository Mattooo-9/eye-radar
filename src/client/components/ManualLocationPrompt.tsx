import { useState } from "react";

interface ManualLocationPromptProps {
  onSubmit: (value: { lat: number; lon: number }) => void;
}

export const ManualLocationPrompt = ({ onSubmit }: ManualLocationPromptProps) => {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  return (
    <div className="manual-card">
      <strong>Подтвердите локацию</strong>
      <p>Обнаружена аномалия геопозиции. Введите координаты вручную.</p>
      <div className="manual-grid">
        <input
          value={lat}
          onChange={(event) => setLat(event.target.value)}
          placeholder="Latitude"
          inputMode="decimal"
        />
        <input
          value={lon}
          onChange={(event) => setLon(event.target.value)}
          placeholder="Longitude"
          inputMode="decimal"
        />
      </div>
      <button
        type="button"
        onClick={() => onSubmit({ lat: Number(lat), lon: Number(lon) })}
      >
        Подтвердить
      </button>
    </div>
  );
};
