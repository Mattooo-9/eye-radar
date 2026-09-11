import React, { useEffect, useRef, useState } from 'react';

/**
 * Dev‑only FPS counter overlay.
 * Shows the average frames per second over the last second.
 * Rendered only when NODE_ENV !== "production".
 */
const FpsCounter: React.FC = () => {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const lastTime = useRef(performance.now());

  useEffect(() => {
    let animationId: number;
    const tick = () => {
      const now = performance.now();
      frames.current++;
      if (now - lastTime.current >= 1000) {
        setFps(frames.current);
        frames.current = 0;
        lastTime.current = now;
      }
      animationId = requestAnimationFrame(tick);
    };
    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, []);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: 8,
    top: 8,
    padding: '2px 4px',
    background: 'rgba(0,0,0,0.6)',
    color: '#fff',
    fontSize: '10px',
    fontFamily: 'sans-serif',
    borderRadius: 2,
    pointerEvents: 'none',
    zIndex: 10000,
  };

  return <div style={style}>FPS: {fps}</div>;
};

export default FpsCounter;
