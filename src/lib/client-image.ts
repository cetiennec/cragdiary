// Browser-side photo downscaling. Vercel caps request bodies at ~4.5 MB, so
// full-size phone photos must be compressed before upload. We prefer WebP
// output (smaller than JPEG at equal quality) and fall back to JPEG where the
// browser can't encode it.

let webpSupport: boolean | null = null;

function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

export async function compressImage(
  file: File,
  maxDimension = 1600,
  quality = 0.82
): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const type = supportsWebp() ? "image/webp" : "image/jpeg";
    const ext = type === "image/webp" ? ".webp" : ".jpg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality)
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ext, { type });
  } catch {
    return file;
  }
}

// Reads the capture date (EXIF DateTimeOriginal) from a JPEG and returns it as
// "YYYY-MM-DD", or null if absent/unreadable. Must run on the ORIGINAL file —
// our canvas compression strips EXIF. iOS hands web file inputs a JPEG (even
// for HEIC library photos), so a minimal JPEG/APP1 parser covers the real case
// without pulling in a dependency.
export async function readPhotoDate(file: File): Promise<string | null> {
  try {
    const head = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(head);
    const len = view.byteLength;
    if (len < 4 || view.getUint16(0) !== 0xffd8) return null; // not JPEG
    let offset = 2;
    while (offset + 4 <= len) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffda) break; // start of scan — metadata is before this
      const size = view.getUint16(offset + 2);
      if (
        marker === 0xffe1 && // APP1
        offset + 10 <= len &&
        view.getUint32(offset + 4) === 0x45786966 && // "Exif"
        view.getUint16(offset + 8) === 0
      ) {
        const date = parseExifDate(view, offset + 10, len);
        if (date) return date;
      }
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

function parseExifDate(view: DataView, tiff: number, len: number): string | null {
  if (tiff + 8 > len) return null;
  const le = view.getUint16(tiff) === 0x4949; // "II" little-endian, else "MM"
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  if (u16(tiff + 2) !== 0x002a) return null;
  const ifd0 = tiff + u32(tiff + 4);

  const findEntry = (ifd: number, tag: number): number | null => {
    if (ifd + 2 > len) return null;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > len) break;
      if (u16(entry) === tag) return entry;
    }
    return null;
  };

  const readDate = (ifd: number, tag: number): string | null => {
    const entry = findEntry(ifd, tag);
    if (entry === null) return null;
    const count = u32(entry + 4);
    const at = count <= 4 ? entry + 8 : tiff + u32(entry + 8);
    let s = "";
    for (let i = 0; i < count - 1 && at + i < len; i++) {
      const c = view.getUint8(at + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    // EXIF datetime is "YYYY:MM:DD HH:MM:SS"
    const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    const [, y, mo, d] = m;
    if (+y < 1990 || +y > 2999 || +mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    return `${y}-${mo}-${d}`;
  };

  // DateTimeOriginal (0x9003) / DateTimeDigitized (0x9004) live in the EXIF
  // sub-IFD, pointed to by tag 0x8769 in IFD0; fall back to DateTime (0x0132).
  const exifPtr = findEntry(ifd0, 0x8769);
  if (exifPtr !== null) {
    const sub = tiff + u32(exifPtr + 8);
    return readDate(sub, 0x9003) ?? readDate(sub, 0x9004) ?? readDate(ifd0, 0x0132);
  }
  return readDate(ifd0, 0x0132);
}
