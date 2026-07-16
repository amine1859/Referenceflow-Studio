import type { FloatingImage, ImageAnnotationPoint, ImageAnnotationStroke } from './store';

export const getAnnotationPageKey = (image: Pick<FloatingImage, 'documentPage'>) =>
  String(Math.max(1, image.documentPage || 1));

export const getVisibleAnnotations = (
  image: FloatingImage,
  pageKey = getAnnotationPageKey(image)
): ImageAnnotationStroke[] => image.type === 'pdf'
  ? image.pdfAnnotations?.[pageKey] || []
  : image.annotations || [];

export const replaceVisibleAnnotations = (
  image: FloatingImage,
  strokes: ImageAnnotationStroke[],
  pageKey = getAnnotationPageKey(image)
): FloatingImage => {
  if (image.type !== 'pdf') return { ...image, annotations: strokes };

  const pdfAnnotations = { ...(image.pdfAnnotations || {}) };
  if (strokes.length > 0) pdfAnnotations[pageKey] = strokes;
  else delete pdfAnnotations[pageKey];
  return { ...image, pdfAnnotations };
};

const formatPathNumber = (value: number) => Number(value.toFixed(2));

export const getSmoothStrokePath = (points: ImageAnnotationPoint[]): string => {
  if (points.length === 0) return '';
  const first = points[0];
  if (points.length === 1) return `M ${formatPathNumber(first.x)} ${formatPathNumber(first.y)}`;
  if (points.length === 2) {
    const last = points[1];
    return `M ${formatPathNumber(first.x)} ${formatPathNumber(first.y)} L ${formatPathNumber(last.x)} ${formatPathNumber(last.y)}`;
  }

  const commands = [`M ${formatPathNumber(first.x)} ${formatPathNumber(first.y)}`];
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index];
    const next = points[index + 1];
    const midpointX = (point.x + next.x) / 2;
    const midpointY = (point.y + next.y) / 2;
    commands.push(
      `Q ${formatPathNumber(point.x)} ${formatPathNumber(point.y)} ${formatPathNumber(midpointX)} ${formatPathNumber(midpointY)}`
    );
  }
  const last = points[points.length - 1];
  commands.push(`T ${formatPathNumber(last.x)} ${formatPathNumber(last.y)}`);
  return commands.join(' ');
};
