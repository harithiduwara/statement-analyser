import { downloadBlob, fileStamp } from './download';

/**
 * Export a chart as an image, with no library and no network.
 *
 * A Recharts chart is an on-page SVG whose colours are CSS custom properties
 * (`var(--series-1)`), which do not resolve once the SVG is lifted out of the
 * document. So the live element's computed styles are read and written inline on
 * a clone before it is rasterised: the exported picture matches exactly what is
 * on screen, in the current theme. The canvas becomes a PNG directly, or a JPEG
 * embedded in a minimal PDF assembled here by hand -- a JPEG needs no
 * compression step, which keeps this dependency-free and within the old-Safari
 * build target.
 */

export interface ChartImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
  title?: string;
}

/** `name` is the base (no extension); a local timestamp and `.png` are appended. */
export async function exportChartPng(svg: SVGSVGElement, name: string): Promise<void> {
  const canvas = await rasterise(svg);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The chart could not be encoded as a PNG.');
  downloadBlob(blob, `${name}-${fileStamp()}.png`);
}

/** `name` is the base (no extension); a local timestamp and `.pdf` are appended. */
export async function exportChartPdf(
  svg: SVGSVGElement,
  options: { title?: string; name: string },
): Promise<void> {
  const canvas = await rasterise(svg);
  const jpeg = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.95));
  const pdf = buildImagePdf([
    {
      jpeg,
      width: canvas.width,
      height: canvas.height,
      ...(options.title === undefined ? {} : { title: options.title }),
    },
  ]);
  downloadBlob(new Blob([pdf as BlobPart], { type: 'application/pdf' }), `${options.name}-${fileStamp()}.pdf`);
}

/** Styles read from the live element and written inline so the clone stands alone. */
const COPIED_STYLES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
] as const;

async function rasterise(svg: SVGSVGElement, scale = 2): Promise<HTMLCanvasElement> {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const serialised = new XMLSerializer().serializeToString(clone);
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialised)}`);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('A 2D canvas context was not available to render the chart.');
  ctx.fillStyle = surfaceColour();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function inlineComputedStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  copyStyles(source, clone);
  const from = source.querySelectorAll('*');
  const to = clone.querySelectorAll('*');
  const count = Math.min(from.length, to.length);
  for (let i = 0; i < count; i += 1) copyStyles(from[i]!, to[i]!);
}

function copyStyles(from: Element, to: Element): void {
  const computed = getComputedStyle(from);
  let style = to.getAttribute('style') ?? '';
  for (const prop of COPIED_STYLES) {
    const value = computed.getPropertyValue(prop);
    if (value) style += `${prop}:${value};`;
  }
  to.setAttribute('style', style);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The chart could not be rendered as an image.'));
    image.src = url;
  });
}

/** The current theme's raised-surface colour, so an export matches the screen. */
function surfaceColour(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--surface-raised').trim();
  return value || '#ffffff';
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A minimal PDF holding one DCTDecode (JPEG) image per page, A4 landscape, each
 * with an optional Helvetica title. Byte offsets are tracked as the file is
 * assembled so the xref table is exact.
 */
export function buildImagePdf(images: readonly ChartImage[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (data: string | Uint8Array): void => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (num: number): void => {
    offsets[num] = length;
  };

  const pageW = 842;
  const pageH = 595;
  const margin = 36;
  const count = images.length;

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  startObject(1);
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = images.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  startObject(2);
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${count} >>\nendobj\n`);

  startObject(3);
  push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  for (let i = 0; i < count; i += 1) {
    const img = images[i]!;
    const pageNum = 4 + i * 3;
    const contentNum = 5 + i * 3;
    const imageNum = 6 + i * 3;

    const titleH = img.title ? 30 : 0;
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - titleH;
    const drawScale = Math.min(availW / img.width, availH / img.height);
    const drawW = img.width * drawScale;
    const drawH = img.height * drawScale;
    const drawX = margin + (availW - drawW) / 2;
    const drawY = margin + (availH - drawH) / 2;

    let content = '';
    if (img.title) {
      content += `BT /F1 13 Tf ${fmt(margin)} ${fmt(pageH - margin - 14)} Td (${escapePdfText(img.title)}) Tj ET\n`;
    }
    content += `q ${fmt(drawW)} 0 0 ${fmt(drawH)} ${fmt(drawX)} ${fmt(drawY)} cm /Im0 Do Q\n`;
    const contentBytes = encoder.encode(content);

    startObject(pageNum);
    push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
        `/Resources << /XObject << /Im0 ${imageNum} 0 R >> /Font << /F1 3 0 R >> >> ` +
        `/Contents ${contentNum} 0 R >>\nendobj\n`,
    );

    startObject(contentNum);
    push(`${contentNum} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    push('\nendstream\nendobj\n');

    startObject(imageNum);
    push(
      `${imageNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} ` +
        `/Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`,
    );
    push(img.jpeg);
    push('\nendstream\nendobj\n');
  }

  const totalObjects = 3 + count * 3;
  const xrefOffset = length;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= totalObjects; n += 1) {
    xref += `${pad10(offsets[n] ?? 0)} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function escapePdfText(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 63;
    if (code === 0x5c) out += '\\\\';
    else if (code === 0x28) out += '\\(';
    else if (code === 0x29) out += '\\)';
    else if (code >= 32 && code <= 126) out += ch;
    else out += '?';
  }
  return out;
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function pad10(value: number): string {
  return String(Math.max(0, Math.round(value))).padStart(10, '0');
}
