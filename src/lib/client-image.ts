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
  maxDimension = 1800,
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
