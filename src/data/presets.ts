/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FloatingReference, WorkspaceLayout, ColorSwatch } from '../types';

// Aesthetic high-resolution images from Unsplash representing typical design/rendering workflows
export const REFERENCE_IMAGES = {
  brutalistConcrete: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80', // Modern architecture
  minimalistCabin: 'https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?auto=format&fit=crop&w=1200&q=80', // Wood & Glass Cabin
  cyberpunkCity: 'https://images.unsplash.com/photo-1515621061946-eff1c2a352bd?auto=format&fit=crop&w=1200&q=80', // Vaporwave / Sci-fi rendering
  clayRender: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80', // 3D matte composition
  industrialSteel: 'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=1200&q=80', // Steel & rust material board
  modernInterior: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80', // Midcentury living scene
  biophilicAtrium: 'https://images.unsplash.com/photo-1545464693-f1798a373343?auto=format&fit=crop&w=1200&q=80', // Greenhouse render study
  abstractMesh: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=1200&q=80', // Organic 3D topography line art
};

// Mock EXIF data for demonstration
export const MOCK_EXIF_MAP: Record<string, any> = {
  brutalistConcrete: {
    camera: 'Sony ILCE-7RM4',
    lens: 'FE 12-24mm F4 G',
    exposure: '1/125s f/8.0 ISO 100',
    dimensions: '9504 x 6336 (60.2 MP)',
    fileSize: '24.1 MB',
    colorSpace: 'sRGB',
    software: 'Adobe Photoshop 25.4 (Windows)',
    gps: '35.6762° N, 139.6503° E',
  },
  minimalistCabin: {
    camera: 'Hasselblad X1D II 50C',
    lens: 'XCD 45mm F3.5',
    exposure: '1/60s f/5.6 ISO 200',
    dimensions: '8272 x 6200 (51.3 MP)',
    fileSize: '32.6 MB',
    colorSpace: 'Display P3',
    software: 'Lightroom Classic 13.0',
    gps: '61.1309° N, 6.7891° E',
  },
  cyberpunkCity: {
    camera: 'Render Core: Unreal Engine 5.4.1',
    lens: 'Virtual Prime 35mm T1.2',
    exposure: 'Raytraced Path Tracer - 2048 spp',
    dimensions: '7680 x 4320 (8K UltraHD)',
    fileSize: '18.4 MB (EXR)',
    colorSpace: 'ACEScg (Linear)',
    software: 'Substance Painter + UE5.4',
    gps: 'N/A - Digital Environment',
  },
};

export const DEFAULT_PALETTE_HISTORY: ColorSwatch[] = [
  {
    id: 'c1',
    hex: '#2B2E34',
    rgb: { r: 43, g: 46, b: 52 },
    hsl: { h: 220, s: 9, l: 19 },
    hsv: { h: 220, s: 17, v: 20 },
    cmyk: { c: 17, m: 12, y: 0, k: 80 },
    lab: { l: 19, a: 0, b: -4 },
    pantone: 'Pantone 426 C',
    name: 'Charcoal Slate',
    timestamp: '11:51:10 AM',
  },
  {
    id: 'c2',
    hex: '#D1C2A5',
    rgb: { r: 209, g: 194, b: 165 },
    hsl: { h: 39, s: 33, l: 73 },
    hsv: { h: 39, s: 21, v: 82 },
    cmyk: { c: 0, m: 7, y: 21, k: 18 },
    lab: { l: 79, a: 2, b: 16 },
    pantone: 'Pantone 7529 C',
    name: 'Raw Concrete Warmth',
    timestamp: '11:51:30 AM',
  },
  {
    id: 'c3',
    hex: '#EAD7C3',
    rgb: { r: 234, g: 215, b: 195 },
    hsl: { h: 31, s: 47, l: 84 },
    hsv: { h: 31, s: 17, v: 92 },
    cmyk: { c: 0, m: 8, y: 17, k: 8 },
    lab: { l: 87, a: 4, b: 13 },
    pantone: 'Pantone 7506 C',
    name: 'Scandi White Birch',
    timestamp: '11:52:00 AM',
  },
  {
    id: 'c4',
    hex: '#1E3E3B',
    rgb: { r: 30, g: 62, b: 59 },
    hsl: { h: 174, s: 35, l: 18 },
    hsv: { h: 174, s: 52, v: 24 },
    cmyk: { c: 52, m: 0, y: 5, k: 76 },
    lab: { l: 23, a: -14, b: -1 },
    pantone: 'Pantone 5535 C',
    name: 'Deep Biophilic Green',
    timestamp: '11:52:15 AM',
  },
  {
    id: 'c5',
    hex: '#FF5E3A',
    rgb: { r: 255, g: 94, b: 58 },
    hsl: { h: 11, s: 100, l: 61 },
    hsv: { h: 11, s: 77, v: 100 },
    cmyk: { c: 0, m: 63, y: 77, k: 0 },
    lab: { l: 59, a: 59, b: 50 },
    pantone: 'Pantone Warm Red C',
    name: 'Architectural Accent Orange',
    timestamp: '11:52:45 AM',
  },
];

export const PRESET_WORKSPACES: WorkspaceLayout[] = [
  {
    id: 'w1',
    name: 'Atlas Glass Tower Board',
    description: 'Material library and moodboard study for a premium curtain-wall glass and architectural concrete skyscraper.',
    canvasZoom: 0.85,
    canvasPan: { x: 50, y: 80 },
    grids: {
      perspectiveType: '2point',
      overlayType: 'thirds',
      gridColor: '#A0AEC0',
      gridOpacity: 0.25,
    },
    palette: [
      {
        id: 'ws-1-1',
        hex: '#8C92AC',
        rgb: { r: 140, g: 146, b: 172 },
        hsl: { h: 229, s: 16, l: 61 },
        hsv: { h: 229, s: 19, v: 67 },
        cmyk: { c: 19, m: 15, y: 0, k: 33 },
        lab: { l: 61, a: 2, b: -14 },
        pantone: 'Pantone 5415 C',
        name: 'Reflective Curtain Glass',
        timestamp: '11:54:00 AM'
      },
      {
        id: 'ws-1-2',
        hex: '#A9A9A9',
        rgb: { r: 169, g: 169, b: 169 },
        hsl: { h: 0, s: 0, l: 66 },
        hsv: { h: 0, s: 0, v: 66 },
        cmyk: { c: 0, m: 0, y: 0, k: 34 },
        lab: { l: 69, a: 0, b: 0 },
        pantone: 'Pantone Cool Gray 7 C',
        name: 'Acid Etched Aluminum',
        timestamp: '11:54:10 AM'
      },
      {
        id: 'ws-1-3',
        hex: '#303437',
        rgb: { r: 48, g: 52, b: 55 },
        hsl: { h: 206, s: 7, l: 20 },
        hsv: { h: 206, s: 13, v: 22 },
        cmyk: { c: 13, m: 5, y: 0, k: 78 },
        lab: { l: 22, a: -1, b: -3 },
        pantone: 'Pantone 425 C',
        name: 'Anodized Dark Bronze profile',
        timestamp: '11:54:20 AM'
      }
    ],
    references: [
      {
        id: 'ref1',
        type: 'image',
        title: 'Brutalist Concrete Frame',
        x: -280,
        y: -150,
        width: 320,
        height: 220,
        scale: 1,
        rotation: 0,
        mirrorH: false,
        mirrorV: false,
        opacity: 1,
        isLocked: false,
        alwaysOnTop: true,
        monitor: 1,
        images: [REFERENCE_IMAGES.brutalistConcrete],
        currentImageIndex: 0,
        crop: null,
        analysis: {
          dominantColors: ['#2B2E34', '#D1C2A5', '#FFFDF9'],
          materials: ['Reinforced Concrete', 'Stained Glass', 'Epoxy Coating'],
          lighting: 'Cold Morning Ambient, Volumetric Diffuse Shadows',
          composition: 'Strong linear vertical perspective, low angle framing',
          tags: ['Brutalist', 'Modernism', 'Facade', 'Architectural Concrete'],
        },
      },
      {
        id: 'ref2',
        type: 'image',
        title: 'Scandi Forest Retreat - Timber Detail',
        x: 80,
        y: -220,
        width: 340,
        height: 240,
        scale: 1,
        rotation: 0,
        mirrorH: false,
        mirrorV: false,
        opacity: 0.95,
        isLocked: false,
        alwaysOnTop: false,
        monitor: 1,
        images: [REFERENCE_IMAGES.minimalistCabin],
        currentImageIndex: 0,
        crop: null,
        analysis: {
          dominantColors: ['#EAD7C3', '#1E3E3B', '#5A4C3D'],
          materials: ['Siberian Larch Cladding', 'Tempered Smart Glass', 'Slate Shingles'],
          lighting: 'Cozy Interior Incandescent / Warm sunset sidelight',
          composition: 'Triangular roof vectors matching the grid thirds',
          tags: ['Cabin', 'Biophilic', 'Timber Frame', 'Nordic Design'],
        },
      },
      {
        id: 'ref3',
        type: 'note',
        title: 'Skyscraper Render Parameters (Octane)',
        x: -280,
        y: 110,
        width: 320,
        height: 180,
        scale: 1,
        rotation: 0,
        mirrorH: false,
        mirrorV: false,
        opacity: 1,
        isLocked: false,
        alwaysOnTop: false,
        monitor: 1,
        images: [],
        currentImageIndex: 0,
        crop: null,
        noteText: 'Render Specs for Octane V4:\n- Kernel: Path Tracing\n- Max Samples: 3500 (Adaptive)\n- GI Clamp: 12 (Minimize Fireflies)\n- Vignetting: 0.8\n- Concrete Bump Map: 4K triplanar map\n- Glass: Clear glass with a subtle blue absorption medium',
      },
      {
        id: 'ref4',
        type: 'image',
        title: 'Midcentury interior ambient light',
        x: 450,
        y: -120,
        width: 300,
        height: 200,
        scale: 1,
        rotation: 0,
        mirrorH: false,
        mirrorV: false,
        opacity: 0.9,
        isLocked: false,
        alwaysOnTop: false,
        monitor: 1,
        images: [REFERENCE_IMAGES.modernInterior],
        currentImageIndex: 0,
        crop: null,
        analysis: {
          dominantColors: ['#CDC5B4', '#1E232B', '#E78C56'],
          materials: ['Polished Walnut', 'Velour sofa fabric', 'Brushed brass'],
          lighting: 'Diffuse afternoon sidelight, atmospheric haze',
          composition: 'Rule of thirds focal points intersecting seating nodes',
          tags: ['Interior', 'Mid-century', 'Residential', 'Volumetric Render'],
        },
      }
    ],
    createdAt: '2026-06-16T11:54:00.000Z',
  },
  {
    id: 'w2',
    name: 'Cyberpunk Game Art Direction',
    description: 'Neon references, material shaders, and dark cityscape compositions for concept modeling in Blender and Substance.',
    canvasZoom: 0.75,
    canvasPan: { x: 0, y: 0 },
    grids: {
      perspectiveType: '3point',
      overlayType: 'golden',
      gridColor: '#FF0055',
      gridOpacity: 0.3,
    },
    palette: [
      {
        id: 'ws-2-1',
        hex: '#0D0E15',
        rgb: { r: 13, g: 14, b: 21 },
        hsl: { h: 232, s: 24, l: 7 },
        hsv: { h: 232, s: 38, v: 8 },
        cmyk: { c: 38, m: 33, y: 0, k: 92 },
        lab: { l: 5, a: 1, b: -5 },
        pantone: 'Pantone Black 6 C',
        name: 'Deep Cyber Void',
        timestamp: '11:55:00 AM'
      },
      {
        id: 'ws-2-2',
        hex: '#FC0D6C',
        rgb: { r: 252, g: 13, b: 108 },
        hsl: { h: 336, s: 97, l: 52 },
        hsv: { h: 336, s: 95, v: 99 },
        cmyk: { c: 0, m: 95, y: 57, k: 1 },
        lab: { l: 50, a: 82, b: 18 },
        pantone: 'Pantone 806 C Neon',
        name: 'Acid Web Magenta',
        timestamp: '11:55:15 AM'
      },
      {
        id: 'ws-2-3',
        hex: '#00F0FF',
        rgb: { r: 0, g: 240, b: 255 },
        hsl: { h: 184, s: 100, l: 50 },
        hsv: { h: 184, s: 100, v: 100 },
        cmyk: { c: 100, m: 6, y: 0, k: 0 },
        lab: { l: 87, a: -44, b: -16 },
        pantone: 'Pantone 801 C Neon',
        name: 'Hyper Cyan Emission',
        timestamp: '11:55:25 AM'
      }
    ],
    references: [
      {
        id: 'ref2-1',
        type: 'image',
        title: 'Cyberpunk Tokyo Night Vista',
        x: -200,
        y: -180,
        width: 380,
        height: 240,
        scale: 1,
        rotation: 0,
        mirrorH: false,
        mirrorV: false,
        opacity: 1,
        isLocked: false,
        alwaysOnTop: true,
        monitor: 1,
        images: [REFERENCE_IMAGES.cyberpunkCity],
        currentImageIndex: 0,
        crop: null,
        analysis: {
          dominantColors: ['#0A0B10', '#FC0D6C', '#00F0FF'],
          materials: ['Wet Asphalt', 'Carbon Fiber Composite', 'Acrylic Neon Tubes'],
          lighting: 'High-contrast emissive point lights, rain puddle reflections',
          composition: 'Three-point camera looking up, heavy scale contrast',
          tags: ['Cyberpunk', 'Environment Art', 'Unreal Engine', 'Emissive'],
        },
      },
      {
        id: 'ref2-2',
        type: 'image',
        title: '3D Matte Shape Composition',
        x: 220,
        y: -100,
        width: 300,
        height: 300,
        scale: 1,
        rotation: 0,
        mirrorH: false,
        mirrorV: false,
        opacity: 0.95,
        isLocked: false,
        alwaysOnTop: false,
        monitor: 1,
        images: [REFERENCE_IMAGES.clayRender],
        currentImageIndex: 0,
        crop: null,
        analysis: {
          dominantColors: ['#CDC2C3', '#8A7A7B', '#FFFFFF'],
          materials: ['Matte Polycarbonate', 'Vaporized Clay Shaders', 'Satiny Plastic'],
          lighting: 'Soft ambient occlusion, studio top rim light',
          composition: 'Perfect spiral alignment, centered focal dome',
          tags: ['Clay Render', 'Concept Shading', 'Modeling', 'Blender'],
        },
      },
      {
        id: 'ref2-3',
        type: 'note',
        title: 'PBR Neon Shader Formula',
        x: -200,
        y: 100,
        width: 380,
        height: 140,
        scale: 1,
        rotation: 0,
        mirrorH: false,
        mirrorV: false,
        opacity: 0.9,
        isLocked: false,
        alwaysOnTop: false,
        monitor: 1,
        images: [],
        currentImageIndex: 0,
        crop: null,
        noteText: 'Blender Shader Tree:\n- Add Emissive Shader Node\n- Color: Cyan (#00F0FF), Strength: 24.5\n- Mix Shader: Blend with Transparent BSDF based on Layer Weight (Fresnel: 0.28)\n- Gives intense realistic neon core with outer soft glass outline!',
      }
    ],
    createdAt: '2026-06-16T11:55:00.000Z',
  }
];

// Production files structure & documentation to act as delivery 1, 2, 3 on architecture
export const PROJECT_STRUCTURE_DOCUMENT = `
# ReferenceFlow Production Repository Tree

This mirrors the structured production repository ready for GitHub, supporting Tauri v2 + React:

\`\`\`text
reference-flow/
├── Src-tauri/
│   ├── Cargo.toml            # Rust dependencies & metadata
│   ├── tauri.conf.json        # Tauri v2 Multi-Window & App Capabilities
│   └── src/
│       ├── main.rs            # Entrypoint & Tauri system trays setup
│       ├── commands/
│       │   ├── file_watcher.rs # Folder watching & hot-updates
│       │   ├── color_picker.rs # Native mouse pixel color grabbing
│       │   ├── window_utils.rs # Always-on-top, transparency, drag API
│       │   └── monitor.rs      # Native multi-monitor metrics retrieval
│       └── db/
│           ├── mod.rs
│           └── schema.sql     # SQLite local schema for layout recovery
├── src/
│   ├── types.ts               # Shared TypeScript schemas
│   ├── main.tsx               # App launcher hook
│   ├── App.tsx                # Context coordination
│   ├── index.css              # PostCSS tailwind definitions
│   ├── components/
│   │   ├── Canvas.tsx         # Infinite pan/zoom rendering canvas
│   │   ├── RefWindow.tsx      # Floating view wrapper
│   │   ├── Sidebar.tsx        # Palette picker, monitor toggles, workspaces
│   │   ├── ScreenMock.tsx     # Simulated Windows environment frame
│   │   ├── CmdPalette.tsx     # Palette overlay
│   │   └── Inspector.tsx      # Code inspect panel
│   └── store/
│       └── workspaceStore.ts  # Zustand reactive global state
├── package.json               # Modern ES modules building definitions
├── vite.config.ts             # Static asset pipelines & proxy handlers
└── .env.example               # Secret declarations
\`\`\`
`;

export const TAURI_CONF_TEMPLATE = `
{
  "productName": "ReferenceFlow",
  "version": "1.0.0",
  "identifier": "com.referenceflow.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:3000",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "ReferenceFlow - Main Workspace",
        "width": 1280,
        "height": 720,
        "resizable": true,
        "fullscreen": false,
        "visible": true,
        "decorations": false,
        "transparent": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' https://* http://* asset: data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi", "zip"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "publisher": "Open Source Design Community",
    "updater": {
      "active": true,
      "endpoints": [
        "https://releases.referenceflow.org/update/{{target}}/{{current_version}}"
      ]
    },
    "windows": {
      "nsis": {
        "oneClick": false,
        "allowToChangeInstallationDirectory": true,
        "shortcutName": "ReferenceFlow",
        "createDesktopShortcut": "always"
      }
    }
  }
}
`;

export const TAURI_RUST_MAIN = `
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager, Monitor, Runtime, WebviewWindow};
use std::sync::Mutex;

struct AppState {
    db_conn: Mutex<rusqlite::Connection>,
}

#[derive(serde::Serialize, Clone)]
struct MonitorInfo {
    name: String,
    width: u32,
    height: u32,
    scale_factor: f64,
    x: i32,
    y: i32,
}

#[tauri::command]
fn get_system_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    let mut infos = Vec::new();
    if let Ok(monitors) = app.available_monitors() {
        for (idx, mon) in monitors.iter().enumerate() {
            let size = mon.size();
            let pos = mon.position();
            infos.push(MonitorInfo {
                name: mon.name().unwrap_or(format!("Display {}", idx + 1)).to_string(),
                width: size.width,
                height: size.height,
                scale_factor: mon.scale_factor(),
                x: pos.x,
                y: pos.y,
            });
        }
    }
    infos
}

#[tauri::command]
fn make_window_transparent(window: WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_blur, apply_mica};
        let _ = apply_mica(&window, None);
        let _ = window.set_ignore_cursor_events(false);
    }
}

#[tauri::command]
fn set_window_always_on_top(window: WebviewWindow, always_on_top: bool) -> Result<(), String> {
    window.set_always_on_top(always_on_top).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_click_through(window: WebviewWindow, click_through: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(click_through).map_err(|e| e.to_string())
}

fn main() {
    let conn = rusqlite::Connection::open("reference_flow.db").expect("Failed to init DB");
    
    // Create baseline tables for autosave recovery
    conn.execute(
        "CREATE TABLE IF NOT EXISTS workspace (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            layout_data TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    ).expect("Failed to create tables");

    tauri::Builder::default()
        .manage(AppState { db_conn: Mutex::new(conn) })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_system_monitors,
            make_window_transparent,
            set_window_always_on_top,
            set_click_through
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`;

export const SQLITE_SCHEMA = `
-- Database Schema for Workspace Auto-saving and Palette Management
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  zoom_factor DOUBLE DEFAULT 1.0,
  pan_x DOUBLE DEFAULT 0.0,
  pan_y DOUBLE DEFAULT 0.0,
  grid_config TEXT, -- JSON payload of perspective/third grids
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS floating_reference (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  ref_type TEXT NOT NULL, -- 'image', 'note', 'group', etc.
  title TEXT,
  pos_x DOUBLE DEFAULT 0.0,
  pos_y DOUBLE DEFAULT 0.0,
  width DOUBLE DEFAULT 300.0,
  height DOUBLE DEFAULT 200.0,
  scale_factor DOUBLE DEFAULT 1.0,
  rotation_degs INT DEFAULT 0,
  mirror_h BOOLEAN DEFAULT 0,
  mirror_v BOOLEAN DEFAULT 0,
  opacity DOUBLE DEFAULT 1.0,
  is_locked BOOLEAN DEFAULT 0,
  always_on_top BOOLEAN DEFAULT 0,
  monitor_id INT DEFAULT 1,
  image_urls TEXT, -- JSON array of source files
  current_img_idx INT DEFAULT 0,
  crop_data TEXT, -- JSON of crop bounding boxes
  note_text TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS color_palette (
  id TEXT PRIMARY KEY,
  hex_code TEXT UNIQUE,
  rgb_json TEXT,
  hsl_json TEXT,
  cmyk_json TEXT,
  pantone_name TEXT,
  name TEXT,
  saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
