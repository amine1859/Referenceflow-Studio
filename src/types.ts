/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type RefWindowType = 'image' | 'note' | 'group' | 'pdf';

export interface CropArea {
  x: number; // percentage 0-100
  y: number;
  width: number;
  height: number;
}

export interface RefImageAnalysis {
  dominantColors: string[];
  materials: string[];
  lighting: string;
  composition: string;
  tags: string[];
}

export interface FloatingReference {
  id: string;
  type: RefWindowType;
  title: string;
  x: number; // Position on the infinite canvas
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number; // in degrees (0, 90, 180, 270 or arbitrary)
  mirrorH: boolean;
  mirrorV: boolean;
  opacity: number; // 0 to 1
  isLocked: boolean;
  alwaysOnTop: boolean;
  monitor: number; // Simulated monitor ID (1, 2, 3)
  isHidden?: boolean; // Toggled from the manager panel to hide/show individual windows
  clickThrough?: boolean; // If true, click events pass down (pointer-events-none)
  windowMode?: 'compact' | 'reference' | 'inspection'; // PureRef window presentation modes
  isFloatingOS?: boolean; // Holds state for true native OS PiP always-on-top windowing mode
  
  // Image type fields
  images: string[]; // List of image URLs
  currentImageIndex: number;
  crop: CropArea | null;
  analysis?: RefImageAnalysis;
  
  // PDF fields
  pdfPages?: number;
  currentPdfPage?: number;
  
  // Note fields
  noteText?: string;
  
  // Group fields
  childWindowIds?: string[];
}

export interface WorkspaceLayout {
  id: string;
  name: string;
  description: string;
  references: FloatingReference[];
  canvasZoom: number;
  canvasPan: { x: number; y: number };
  grids: {
    perspectiveType: 'none' | '1point' | '2point' | '3point';
    overlayType: 'none' | 'thirds' | 'golden' | 'isometric' | 'grid';
    gridColor: string;
    gridOpacity: number;
  };
  palette: ColorSwatch[];
  createdAt: string;
}

export interface ColorSwatch {
  id: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
  hsv: { h: number; s: number; v: number };
  cmyk: { c: number; m: number; y: number; k: number };
  lab: { l: number; a: number; b: number };
  pantone: string;
  name?: string;
  timestamp: string;
}

export interface HistoricalState {
  references: FloatingReference[];
  canvasZoom: number;
  canvasPan: { x: number; y: number };
}

export interface GlobalHotkey {
  id: string;
  name: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  description: string;
}
