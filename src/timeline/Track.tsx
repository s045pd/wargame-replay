import { useRef, useEffect } from 'react';

export interface TrackRenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

export interface TrackProps {
  label: string;
  height: number;
  color: string;
  /** Optional render callback invoked after clearing the canvas */
  onRender?: (context: TrackRenderContext) => void;
  /** Click callback — receives the fractional position (0–1) along the track width */
  onClick?: (ratio: number) => void;
}

/**
 * A single horizontal track with a Canvas surface.
 * Accepts a label, height, accent color, optional render and click callbacks.
 */
export function Track({ label, height, color, onRender, onClick }: TrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio ?? 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w === 0 || h === 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (onRender) {
      onRender({ ctx, width: w, height: h });
    }
  }, [onRender, height]);

  const handleClick = (e: React.MouseEvent) => {
    if (!onClick || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    onClick(ratio);
  };

  return (
    <div className="flex items-stretch border-b border-zinc-800 last:border-b-0" style={{ height }}>
      {/* Label sidebar */}
      <div
        className="w-24 shrink-0 flex items-center px-2 text-[10px] font-medium tracking-wider uppercase border-r border-zinc-800"
        style={{ color, borderLeftColor: color, borderLeftWidth: 2 }}
      >
        {label}
      </div>
      {/* Canvas surface */}
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden ${onClick ? 'cursor-pointer' : ''}`}
        onClick={handleClick}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ display: 'block' }}
        />
      </div>
    </div>
  );
}
