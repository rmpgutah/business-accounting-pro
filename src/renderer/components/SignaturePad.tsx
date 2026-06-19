import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Trash2, Upload, Check } from 'lucide-react';

/**
 * High-quality signature pad with smooth Bezier curve interpolation.
 * Renders on a transparent-background canvas, exports as PNG data URL.
 * Supports pressure-sensitive stroke width via pointer events.
 */

interface SignaturePadProps {
  /** Current signature as data URL (base64 PNG) */
  value?: string;
  /** Called with data URL on save, or '' on clear */
  onChange: (dataUrl: string) => void;
  /** Canvas width in px */
  width?: number;
  /** Canvas height in px */
  height?: number;
}

interface Point {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

const SignaturePad: React.FC<SignaturePadProps> = ({
  value,
  onChange,
  width = 460,
  height = 140,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const pointsRef = useRef<Point[]>([]);
  const lastPointRef = useRef<Point | null>(null);

  // Render existing signature image onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set actual resolution (2x for retina clarity)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        setHasStrokes(true);
      };
      img.src = value;
    } else {
      setHasStrokes(false);
    }
  }, [value, width, height]);

  const getPoint = (e: React.PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5,
      time: Date.now(),
    };
  };

  // Smooth Bezier curve stroke between points
  const drawSegment = useCallback((ctx: CanvasRenderingContext2D, p1: Point, p2: Point) => {
    // Stroke width varies with pressure (1.5 to 3px)
    const minWidth = 1.2;
    const maxWidth = 3.0;
    const strokeWidth = minWidth + (maxWidth - minWidth) * p2.pressure;

    // Velocity-based tapering: faster = thinner
    const dt = Math.max(p2.time - p1.time, 1);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const velocity = Math.sqrt(dx * dx + dy * dy) / dt;
    const velocityFactor = Math.max(0.4, 1 - velocity * 0.15);

    ctx.lineWidth = strokeWidth * velocityFactor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';

    // Use quadratic curve for smoothness
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
    ctx.stroke();
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const point = getPoint(e);
    pointsRef.current = [point];
    lastPointRef.current = point;
    setIsDrawing(true);
    setHasStrokes(true);

    // Draw a dot for single taps
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const point = getPoint(e);
    const lastPoint = lastPointRef.current;
    if (!lastPoint) return;

    // Skip if barely moved (reduces jagginess)
    const dist = Math.sqrt((point.x - lastPoint.x) ** 2 + (point.y - lastPoint.y) ** 2);
    if (dist < 1.5) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSegment(ctx, lastPoint, point);
    ctx.restore();

    lastPointRef.current = point;
    pointsRef.current.push(point);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    pointsRef.current = [];
    onChange('');
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;

    // Export at full resolution as PNG
    const dataUrl = canvas.toDataURL('image/png');
    onChange(dataUrl);
  };

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/svg+xml';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) {
          onChange(dataUrl);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return (
    <div>
      {/* Canvas */}
      <div
        style={{
          width,
          height,
          border: '1.5px solid #333',
          borderRadius: '6px',
          background: '#fff',
          position: 'relative',
          cursor: 'crosshair',
          touchAction: 'none',
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width, height, display: 'block' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {/* Guide text when empty */}
        {!hasStrokes && !value && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#bbb',
              fontSize: '13px',
              fontStyle: 'italic',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            Sign here
          </div>
        )}
        {/* Signature line */}
        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            right: '20px',
            borderBottom: '1px solid #ccc',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '6px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '8px',
            color: '#bbb',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            fontWeight: '600',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          Authorized Signature
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button
          onClick={handleSave}
          disabled={!hasStrokes}
          className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
          style={{ borderRadius: '6px', opacity: hasStrokes ? 1 : 0.4 }}
        >
          <Check size={13} />
          Save Signature
        </button>
        <button
          onClick={handleClear}
          className="block-btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary"
          style={{ borderRadius: '6px' }}
        >
          <Trash2 size={13} />
          Clear
        </button>
        <button
          onClick={handleUpload}
          className="block-btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary"
          style={{ borderRadius: '6px' }}
        >
          <Upload size={13} />
          Upload Image
        </button>
      </div>
    </div>
  );
};

export default SignaturePad;
