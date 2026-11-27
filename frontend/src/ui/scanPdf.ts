import { UiError } from './errors';

export const MAX_SCAN_PAGES = 20;
export const MAX_SCAN_PDF_MIB = 10;
const MAX_SCAN_PDF_BYTES = MAX_SCAN_PDF_MIB * 1024 * 1024;
// Leave room for the PDF dictionaries, page streams, and cross-reference table.
export const MAX_SCAN_IMAGE_BYTES = MAX_SCAN_PDF_BYTES - 32 * 1024;

export type ScanImage = {
  jpeg: Blob;
  width: number;
  height: number;
};

export function createScanPdf(images: readonly ScanImage[]): File {
  if (!images.length || images.length > MAX_SCAN_PAGES) {
    throw new UiError('Capture between 1 and ' + MAX_SCAN_PAGES + ' pages before continuing.');
  }
  if (images.some(({ jpeg, width, height }) =>
    jpeg.type !== 'image/jpeg' || !jpeg.size || !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) || width < 1 || height < 1)) {
    throw new UiError('A captured page could not be added to the PDF. Retake that page and try again.');
  }
  if (images.reduce((size, image) => size + image.jpeg.size, 0) > MAX_SCAN_IMAGE_BYTES) {
    throw new UiError('The scan is too large. Remove a page or split the scan into smaller files.');
  }

  // PDF 1.4 uses byte offsets. All generated strings below are ASCII.
  const parts: BlobPart[] = [];
  const offsets = [0];
  let length = 0;

  function write(part: string | Blob) {
    parts.push(part);
    length += typeof part === 'string' ? part.length : part.size;
  }

  function object(id: number, body: string, stream?: Blob) {
    offsets[id] = length;
    write(id + ' 0 obj\n' + body + '\n');
    if (stream) {
      write('stream\n');
      write(stream);
      write('\nendstream\n');
    }
    write('endobj\n');
  }

  write('%PDF-1.4\n');
  write(new Blob([new Uint8Array([37, 226, 227, 207, 211, 10])]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = images.map((_, index) => (3 + index * 3) + ' 0 R');
  object(2, '<< /Type /Pages /Count ' + images.length + ' /Kids [' + kids.join(' ') + '] >>');

  images.forEach(({ jpeg, width, height }, index) => {
    const page = 3 + index * 3;
    const image = page + 1;
    const contents = page + 2;
    const landscape = width > height;
    const pageWidth = landscape ? 792 : 612;
    const pageHeight = landscape ? 612 : 792;
    const margin = 18;
    const scale = Math.min((pageWidth - 2 * margin) / width, (pageHeight - 2 * margin) / height);
    const w = width * scale;
    const h = height * scale;
    const matrix = [w, 0, 0, h, (pageWidth - w) / 2, (pageHeight - h) / 2].map(value => value.toFixed(3));
    const paint = new Blob(['q\n', matrix.join(' '), ' cm\n/Photo Do\nQ\n']);

    object(page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageWidth + ' ' + pageHeight +
      '] /Resources << /XObject << /Photo ' + image + ' 0 R >> >> /Contents ' + contents + ' 0 R >>');
    object(image, '<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.size + ' >>', jpeg);
    object(contents, '<< /Length ' + paint.size + ' >>', paint);
  });

  const xref = length;
  write('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  offsets.slice(1).forEach(offset => write(String(offset).padStart(10, '0') + ' 00000 n \n'));
  write('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

  if (length > MAX_SCAN_PDF_BYTES) {
    throw new UiError('The PDF exceeds ' + MAX_SCAN_PDF_MIB + ' MiB. Remove a page and try again.');
  }
  return new File(parts, 'scanned-exam.pdf', { type: 'application/pdf' });
}
