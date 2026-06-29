import React, { useEffect, useRef, useState } from 'react';

export default function NoteImageMarkupModal({ source, onCancel, onSave }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [strokeColor, setStrokeColor] = useState('#f85149');
  const [strokeWidth, setStrokeWidth] = useState(5);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = source;
  }, [source]);

  const canvasPoint = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvasRef.current.width / rect.width),
      y: (event.clientY - rect.top) * (canvasRef.current.height / rect.height),
    };
  };

  const drawTo = (event) => {
    if (!drawingRef.current || !lastPointRef.current) return;
    const point = canvasPoint(event);
    const last = lastPointRef.current;
    const context = canvasRef.current.getContext('2d');
    context.strokeStyle = strokeColor;
    context.lineWidth = strokeWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(last.x, last.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal markup-modal">
        <div className="section-title">
          <h2>Markup Image</h2>
          <div className="markup-toolbar">
            <label className="markup-color-control">
              Color
              <input type="color" value={strokeColor} onChange={(event) => setStrokeColor(event.target.value)} />
            </label>
            <label className="markup-color-control">
              Stroke
              <input type="range" min="2" max="24" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} />
            </label>
          </div>
        </div>
        <canvas
          ref={canvasRef}
          className="markup-canvas"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drawingRef.current = true;
            lastPointRef.current = canvasPoint(event);
          }}
          onPointerMove={drawTo}
          onPointerUp={() => {
            drawingRef.current = false;
            lastPointRef.current = null;
          }}
          onPointerCancel={() => {
            drawingRef.current = false;
            lastPointRef.current = null;
          }}
        />
        <div className="modal-footer">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button onClick={() => onSave(canvasRef.current.toDataURL('image/png'))}>Save Markup</button>
        </div>
      </div>
    </div>
  );
}
