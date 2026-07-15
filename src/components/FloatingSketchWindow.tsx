import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Move, Lock, Unlock, X, PenTool, Brush, Eraser, ChevronDown, ChevronUp } from 'lucide-react';
import { FloatingSketch, FloatingSketchLine } from '../lib/store';

interface Props {
  sketch: FloatingSketch;
  updateSketch: (id: string, updates: Partial<FloatingSketch>) => void;
  closeSketch: (id: string) => void;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onResizeMouseDown: (e: React.MouseEvent, id: string) => void;
  isActive?: boolean;
  onInteraction?: () => void;
  logWindowLockState?: (windowType: 'image' | 'note' | 'sketch', windowId: string, isLocked: boolean) => void;
  isDragging?: boolean;
  isResizing?: boolean;
}

export function FloatingSketchWindow({ 
  sketch, 
  updateSketch, 
  closeSketch, 
  onMouseDown, 
  onResizeMouseDown, 
  isActive, 
  onInteraction, 
  logWindowLockState,
  isDragging = false,
  isResizing = false
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentLine, setCurrentLine] = useState<FloatingSketchLine | null>(null);
  const [color, setColor] = useState('#000000');
  const sizeOptions = [2, 4, 8, 16, 24];
  const [sizeIndex, setSizeIndex] = useState(1);
  const lineWidth = sizeOptions[sizeIndex];
  const [tool, setTool] = useState<'pen' | 'brush' | 'eraser'>('pen');

  // Redraw canvas on update
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Scale canvas to match internal resolution
    canvas.width = sketch.width;
    canvas.height = sketch.height;
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const linesToDraw = currentLine ? [...sketch.lines, currentLine] : sketch.lines;
    
    linesToDraw.forEach(line => {
      if (line.points.length === 0) return;
      
      const isLineEraser = line.isEraser || line.tool === 'eraser';
      
      // If it's a single point, render as a nice circular dot
      if (line.points.length === 1) {
        ctx.beginPath();
        const fillCol = isLineEraser ? sketch.backgroundColor : line.color;
        ctx.fillStyle = fillCol;
        if (isLineEraser) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,1)';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          if (line.tool === 'brush') {
            ctx.globalAlpha = 0.5;
          } else {
            ctx.globalAlpha = 1.0;
          }
        }
        ctx.arc(line.points[0].x, line.points[0].y, line.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      
      ctx.beginPath();
      ctx.strokeStyle = isLineEraser ? sketch.backgroundColor : line.color;
      ctx.lineWidth = line.width;
      
      // Remove weird halo/shadow and reset shadow parameters
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      
      if (isLineEraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.globalAlpha = 1.0;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        if (line.tool === 'brush') {
          // Soft semi-transparent brush effect without a weird shadow glow
          ctx.globalAlpha = 0.5;
        } else {
          ctx.globalAlpha = 1.0;
        }
      }
      
      // Implement Catmull-Rom cubic Bezier curve interpolation for ultra smooth, flowing lines
      ctx.moveTo(line.points[0].x, line.points[0].y);
      if (line.points.length === 2) {
        ctx.lineTo(line.points[1].x, line.points[1].y);
      } else {
        for (let i = 0; i < line.points.length - 1; i++) {
          const p0 = line.points[i - 1] || line.points[i];
          const p1 = line.points[i];
          const p2 = line.points[i + 1];
          const p3 = line.points[i + 2] || p2;
          
          const cp1x = p1.x + (p2.x - p0.x) / 6;
          const cp1y = p1.y + (p2.y - p0.y) / 6;
          const cp2x = p2.x - (p3.x - p1.x) / 6;
          const cp2y = p2.y - (p3.y - p1.y) / 6;
          
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    });
    
    // Reset back to source-over and clear shadow
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
  }, [sketch, currentLine]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (sketch.isLocked) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const scaleX = sketch.width / rect.width;
    const scaleY = sketch.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    setIsDrawing(true);
    setCurrentLine({
      color,
      width: lineWidth,
      isEraser: tool === 'eraser',
      tool,
      points: [{x, y}]
    });
    
    // Capture pointer events
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing || !currentLine) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const scaleX = sketch.width / rect.width;
    const scaleY = sketch.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    // Apply low-pass input smoothing for professional, flutter-free pen stroke tracking
    const points = currentLine.points;
    const lastPoint = points[points.length - 1];
    const smoothingFactor = 0.45; // 0.45 is highly responsive yet incredibly elegant
    const smoothX = lastPoint.x + (x - lastPoint.x) * smoothingFactor;
    const smoothY = lastPoint.y + (y - lastPoint.y) * smoothingFactor;
    
    setCurrentLine({
      ...currentLine,
      points: [...points, { x: smoothX, y: smoothY }]
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDrawing || !currentLine) return;
    setIsDrawing(false);
    updateSketch(sketch.id, {
      lines: [...sketch.lines, currentLine]
    });
    setCurrentLine(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ 
        opacity: sketch.isCollapsed ? 0 : 1, 
        scale: sketch.isCollapsed ? 0.95 : 1, 
        y: sketch.isCollapsed ? 10 : 0
      }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      transition={(isDragging || isResizing) ? { type: "tween", duration: 0 } : { type: "spring", damping: 25, stiffness: 300, mass: 0.5 }}
      className={`absolute bg-transparent flex flex-col group drop-shadow-2xl pointer-events-auto floating-window`}
      data-id={sketch.id}
      data-click-through={sketch.isLocked ? 'true' : 'false'}
      data-collapsed={sketch.isCollapsed ? 'true' : 'false'}
      onMouseDown={onInteraction}
      style={{
        left: sketch.x,
        top: sketch.y,
        width: sketch.width,
        zIndex: isActive ? 6500 : 6000,
      }}
    >
      <div 
         className={`absolute bottom-full left-0 w-full h-[32px] dark:bg-slate-900/80 bg-white/80 backdrop-blur-sm ${sketch.isCollapsed ? 'rounded-lg' : 'rounded-t-lg'} transition-all flex items-center justify-between px-2 ${!sketch.isLocked ? 'cursor-move' : 'cursor-default'} border dark:border-white/10 border-black/10 ${sketch.isCollapsed ? 'opacity-100' : (sketch.isLocked ? 'opacity-20 hover:opacity-100' : 'opacity-0 group-hover:opacity-100')} floating-sketch-drag-handle z-10 gap-2 pointer-events-auto`}
         onMouseDown={(e) => {
           if (!sketch.isLocked) onMouseDown(e, sketch.id);
         }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <Move className={`w-3 h-3 shrink-0 ${sketch.isLocked ? 'text-slate-600' : 'text-slate-400'}`} />
        </div>
        
        <div className="flex flex-nowrap gap-1 items-center justify-end shrink-0" onMouseDown={(e) => e.stopPropagation()}>
          {!sketch.isLocked && !sketch.isCollapsed && (
            <div className="flex items-center space-x-1 border-r border-slate-700 pr-1 mr-1">
              <button 
                onClick={() => setTool('pen')}
                className={`p-1 rounded transition-colors ${tool === 'pen' ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white'}`}
                title="Pen"
              >
                <PenTool className="w-3 h-3" />
              </button>
              <button 
                onClick={() => setTool('brush')}
                className={`p-1 rounded transition-colors ${tool === 'brush' ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white'}`}
                title="Brush"
              >
                <Brush className="w-3 h-3" />
              </button>
              <button 
                onClick={() => setTool('eraser')}
                className={`p-1 rounded transition-colors ${tool === 'eraser' ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white'}`}
                title="Eraser"
              >
                <Eraser className="w-3 h-3" />
              </button>
              <button
                onClick={() => setSizeIndex((sizeIndex + 1) % sizeOptions.length)}
                className="w-5 h-5 flex items-center justify-center p-0.5 rounded transition-colors hover:bg-white/10 mx-1"
                title="Change Size"
              >
                <div 
                  className="rounded-full bg-slate-200" 
                  style={{ 
                    width: Math.max(2, sizeOptions[sizeIndex] / 2), 
                    height: Math.max(2, sizeOptions[sizeIndex] / 2) 
                  }} 
                />
              </button>
              {tool !== 'eraser' && (
                <input 
                  type="color" 
                  value={color} 
                  onChange={(e) => setColor(e.target.value)}
                  className="w-4 h-4 rounded overflow-hidden cursor-pointer bg-transparent border-none p-0 mx-1"
                />
              )}
              <button 
                onClick={() => updateSketch(sketch.id, { lines: [] })}
                className="text-xs font-mono px-1.5 text-slate-400 hover:text-white transition-colors"
                title="Clear Sketch"
              >
                CLEAR
              </button>
            </div>
          )}
          
          <button 
            onClick={() => updateSketch(sketch.id, { isCollapsed: !sketch.isCollapsed })}
            className="hover:bg-white/10 p-1 rounded transition-colors text-slate-400 hover:text-white"
            title={sketch.isCollapsed ? "Expand Sketch" : "Collapse Sketch"}
          >
            {sketch.isCollapsed ? <ChevronDown className="w-3 h-3 text-sky-400" /> : <ChevronUp className="w-3 h-3" />}
          </button>
          <button 
            onClick={() => {
              const nextLocked = !sketch.isLocked;
              updateSketch(sketch.id, { isLocked: nextLocked });
              if (logWindowLockState) {
                logWindowLockState('sketch', sketch.id, nextLocked);
              }
            }}
            className="hover:bg-white/10 p-1 rounded transition-colors text-slate-400 hover:text-white"
            title={sketch.isLocked ? "Unlock Sketch" : "Lock Sketch"}
          >
            {sketch.isLocked ? <Lock className="w-3 h-3 text-sky-400" /> : <Unlock className="w-3 h-3" />}
          </button>
          <button 
            onClick={() => closeSketch(sketch.id)}
            className="hover:bg-red-500/80 p-1 rounded transition-colors text-slate-400 hover:text-white"
            title="Close Sketch"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
      
      <motion.div 
        animate={{
          height: sketch.isCollapsed ? 0 : sketch.height,
          opacity: sketch.isCollapsed ? 0 : 1,
          borderWidth: sketch.isCollapsed ? 0 : 1
        }}
        transition={isResizing ? { duration: 0 } : { duration: 0.2, ease: "easeInOut" }}
        className={`relative rounded-b-md rounded-t-none overflow-hidden shadow-xl border-black/10 flex flex-col ${sketch.isLocked ? 'pointer-events-none' : 'pointer-events-auto'}`}
        style={{ backgroundColor: sketch.backgroundColor }}
      >
          <div className="w-full h-full relative" onMouseDown={(e) => { if (sketch.isLocked) e.stopPropagation(); }}>
            <canvas
              ref={canvasRef}
              className={`w-full h-full block ${sketch.isLocked ? 'pointer-events-none' : 'cursor-crosshair'}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>
        
        {!sketch.isLocked && (
          <div 
            className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-50 flex items-end justify-end p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
            onMouseDown={(e) => onResizeMouseDown(e, sketch.id)}
          >
            <div className="w-2.5 h-2.5 border-r-[2px] border-b-[2px] border-black/20 rounded-br-[1px]"></div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
