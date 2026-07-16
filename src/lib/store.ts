import { get, set } from 'idb-keyval';
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

export interface FloatingImage {
  id: string;
  url: string; // Will store base64 string
  x: number;
  y: number;
  width: number;
  opacity: number;
  isLocked: boolean;
  rotation: number;
  palette?: string[];
  isCollapsed?: boolean;
  zoom?: number;
  panX?: number;
  panY?: number;
  isHighRes?: boolean;
  type?: 'image' | 'pdf';
  documentPage?: number;
  documentNumPages?: number;
  isSearchInProgress?: boolean;
  searchStatus?: string;
  pHash?: string;
  annotations?: ImageAnnotationStroke[];
  pdfAnnotations?: Record<string, ImageAnnotationStroke[]>;
}

export interface FloatingNote {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
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
  return projects || [];
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

export async function createProject(name: string): Promise<Project> {
  const newProject: Project = {
    id: uuidv4(),
    name,
    images: [],
    floatingImages: [],
    floatingNotes: [],
    floatingSketches: [],
    updatedAt: Date.now()
  };
  const projects = await getProjects();
  await saveProjects([...projects, newProject]);
  return newProject;
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<void> {
  const projects = await getProjects();
  const updatedProjects = projects.map(p => 
    p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
  );
  await saveProjects(updatedProjects);
}

export async function deleteProject(id: string): Promise<void> {
  const projects = await getProjects();
  await saveProjects(projects.filter(p => p.id !== id));
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
