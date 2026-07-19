import { get, set, update as updateValue } from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';

export interface ImageAnnotationPoint {
  x: number;
  y: number;
}

export interface ImageAnnotationStroke {
  color: string;
  width: number;
  points: ImageAnnotationPoint[];
}

export type FloatingMediaType = 'image' | 'pdf' | 'docx' | 'xlsx';

export const BRAND_KIT_FOLDER_NAMES = [
  'Overview',
  'Moodboard',
  'Guidelines',
  'Logos',
  'Colors',
  'Typography',
  'Icons',
  'Imagery',
  'Textures & Patterns',
  'Templates'
] as const;

export const STANDARD_BOARD_FOLDER_NAMES = [
  'Images',
  'Documents',
  'PDFs',
  'Illustration',
  'InDesign',
  'Photoshop',
  'Notes',
  'Sketches'
] as const;

export type ProjectTemplate = 'blank' | 'brand-kit';
export type DesignAssetKind = 'psd' | 'psb' | 'ai' | 'ait' | 'eps' | 'indd' | 'indt' | 'idml' | 'otf' | 'ttf' | 'woff' | 'woff2';

export interface BoardFolder {
  id: string;
  name: string;
  order: number;
}

export interface DesignAsset {
  id: string;
  previewOrder?: number;
  fileName: string;
  displayName?: string;
  kind: DesignAssetKind;
  relativePath: string;
  size: number;
  modifiedAt: number;
  folderId?: string;
}

export interface BrandColor {
  id: string;
  name: string;
  hex: string;
  group?: 'primary' | 'secondary';
}

export interface BrandTypographyStyle {
  id: string;
  name: string;
  fontFamily: string;
  weight: number;
  sampleText: string;
}

export interface OfficeDocumentEdits {
  docxText?: string;
  xlsxActiveSheet?: string;
  xlsxCells?: Record<string, Record<string, string>>;
}

export interface FloatingImage {
  id: string;
  previewOrder?: number;
  folderId?: string;
  url: string; // Will store base64 string
  fileName?: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  opacity: number;
  isLocked: boolean;
  rotation: number;
  palette?: string[];
  isCollapsed?: boolean;
  zoom?: number;
  panX?: number;
  panY?: number;
  isHighRes?: boolean;
  type?: FloatingMediaType;
  documentPage?: number;
  documentNumPages?: number;
  isSearchInProgress?: boolean;
  searchStatus?: string;
  pHash?: string;
  annotations?: ImageAnnotationStroke[];
  pdfAnnotations?: Record<string, ImageAnnotationStroke[]>;
  officeEdits?: OfficeDocumentEdits;
}

export interface FloatingNote {
  id: string;
  previewOrder?: number;
  folderId?: string;
  name?: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  lockAspectRatio?: boolean;
  isLocked?: boolean;
  isCollapsed?: boolean;
}

export interface FloatingSketchLine {
  color: string;
  width: number;
  points: {x: number, y: number}[];
  isEraser?: boolean;
  tool?: 'pen' | 'brush' | 'eraser';
}

export interface FloatingSketch {
  id: string;
  previewOrder?: number;
  folderId?: string;
  name?: string;
  lines: FloatingSketchLine[];
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  isLocked?: boolean;
  isCollapsed?: boolean;
}

export interface Project {
  id: string;
  name: string;
  boardTemplate?: ProjectTemplate;
  folders?: BoardFolder[];
  designAssets?: DesignAsset[];
  brandColors?: BrandColor[];
  brandTypography?: BrandTypographyStyle[];
  images: string[];
  floatingImages: FloatingImage[];
  floatingNotes: FloatingNote[];
  floatingSketches?: FloatingSketch[];
  updatedAt: number;
  directoryHandle?: any;
  directoryPath?: string;
}

const PROJECTS_KEY = 'ref-flow-projects';
const ACTIVE_PROJECT_ID_KEY = 'ref-flow-active-project-id';

export async function getProjects(): Promise<Project[]> {
  const projects = await get<Project[]>(PROJECTS_KEY);
  if (!projects) return [];
  let changed = false;
  const normalizedProjects = projects.map(project => {
    if (Array.isArray(project.folders)) return project;
    changed = true;
    const folderNames = project.boardTemplate === 'brand-kit'
      ? [...BRAND_KIT_FOLDER_NAMES, ...STANDARD_BOARD_FOLDER_NAMES]
      : [...STANDARD_BOARD_FOLDER_NAMES];
    return {
      ...project,
      boardTemplate: project.boardTemplate || 'blank',
      folders: folderNames.map((folderName, order) => ({ id: uuidv4(), name: folderName, order })),
      designAssets: project.designAssets || [],
      brandColors: project.brandColors || [],
      brandTypography: project.brandTypography || []
    };
  });
  if (changed) await set(PROJECTS_KEY, normalizedProjects);
  return normalizedProjects;
}

export async function saveProjects(projects: Project[]): Promise<void> {
  await set(PROJECTS_KEY, projects);
}

export async function getActiveProjectId(): Promise<string | null> {
  return await get<string>(ACTIVE_PROJECT_ID_KEY) ?? null;
}

export async function setActiveProjectId(id: string | null): Promise<void> {
  await set(ACTIVE_PROJECT_ID_KEY, id);
}

export async function createProject(name: string, template: ProjectTemplate = 'blank'): Promise<Project> {
  const folderNames = template === 'brand-kit'
    ? [...BRAND_KIT_FOLDER_NAMES, ...STANDARD_BOARD_FOLDER_NAMES]
    : [...STANDARD_BOARD_FOLDER_NAMES];
  const folders = folderNames.map((folderName, order) => ({ id: uuidv4(), name: folderName, order }));
  const newProject: Project = {
    id: uuidv4(),
    name,
    boardTemplate: template,
    folders,
    designAssets: [],
    brandColors: [],
    brandTypography: [],
    images: [],
    floatingImages: [],
    floatingNotes: [],
    floatingSketches: [],
    updatedAt: Date.now()
  };
  await updateValue<Project[]>(PROJECTS_KEY, projects => [...(projects || []), newProject]);
  return newProject;
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<void> {
  await updateValue<Project[]>(PROJECTS_KEY, projects => (projects || []).map(project =>
    project.id === id ? { ...project, ...updates, updatedAt: Date.now() } : project
  ));
}

export async function deleteProject(id: string): Promise<void> {
  await updateValue<Project[]>(PROJECTS_KEY, projects => (projects || []).filter(project => project.id !== id));
}

// Helper to convert Image File -> Base64
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}
