import type { FloatingImage, FloatingMediaType, Project } from './store';

export type ProjectMediaSnapshot = {
  backgroundSources: string[];
  floatingSources: Array<{ id: string; source: string; type: FloatingMediaType }>;
};

export const sanitizeExportStem = (value: string) => (value || 'untitled')
  .replace(/[^a-z0-9._-]+/gi, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 80) || 'untitled';

export const getSavedMediaExtension = (source: string, type: FloatingMediaType = 'image') => {
  if (type === 'docx' || /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i.test(source) || /\.docx(?:$|[?#])/i.test(source)) return 'docx';
  if (type === 'xlsx' || /^data:application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/i.test(source) || /\.xlsx(?:$|[?#])/i.test(source)) return 'xlsx';
  if (type === 'pdf' || /^data:application\/pdf/i.test(source) || /\.pdf(?:$|[?#])/i.test(source)) return 'pdf';
  return /^data:image\/jpe?g/i.test(source) || /\.jpe?g(?:$|[?#])/i.test(source) ? 'jpg' : 'png';
};

export const getBackgroundMediaFileName = (source: string, index: number) =>
  `background_${index + 1}.${getSavedMediaExtension(source)}`;

export const getFloatingMediaFileName = (image: FloatingImage) =>
  `floating_${sanitizeExportStem(image.id)}.${getSavedMediaExtension(image.url, image.type || 'image')}`;

export const createProjectMediaSnapshot = (project: Pick<Project, 'images' | 'floatingImages'>): ProjectMediaSnapshot => ({
  backgroundSources: [...(project.images || [])],
  floatingSources: (project.floatingImages || []).map(image => ({
    id: image.id,
    source: image.url,
    type: image.type || 'image'
  }))
});

export const projectMediaSnapshotsEqual = (left?: ProjectMediaSnapshot, right?: ProjectMediaSnapshot) => {
  if (!left || !right || left.backgroundSources.length !== right.backgroundSources.length || left.floatingSources.length !== right.floatingSources.length) {
    return false;
  }
  for (let index = 0; index < left.backgroundSources.length; index++) {
    if (left.backgroundSources[index] !== right.backgroundSources[index]) return false;
  }
  for (let index = 0; index < left.floatingSources.length; index++) {
    const a = left.floatingSources[index];
    const b = right.floatingSources[index];
    if (a.id !== b.id || a.source !== b.source || a.type !== b.type) return false;
  }
  return true;
};

export const createLocalBoardManifest = (project: Project, mediaPrefix: string) => ({
  ...project,
  directoryHandle: undefined,
  images: (project.images || []).map((source, index) => `${mediaPrefix}${getBackgroundMediaFileName(source, index)}`),
  floatingImages: (project.floatingImages || []).map(image => ({
    ...image,
    url: `${mediaPrefix}${getFloatingMediaFileName(image)}`
  })),
  exportedAt: new Date().toISOString()
});
