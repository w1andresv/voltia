const MAX_EDGE = 720;
// El bucket de Supabase Storage limita a 1 MB por archivo (fase 1 del plan);
// dejamos margen para el overhead de la subida.
const MAX_BYTES = 900_000;

export async function compressPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo no es una imagen");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo comprimir la foto");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let quality = 0.72;
    let blob = await toJpegBlob(canvas, quality);
    while (blob.size > MAX_BYTES && quality > 0.4) {
      quality -= 0.12;
      blob = await toJpegBlob(canvas, quality);
    }
    if (blob.size > MAX_BYTES) throw new Error("La foto sigue siendo demasiado pesada");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo comprimir la foto"))),
      "image/jpeg",
      quality,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer la imagen"));
    img.src = src;
  });
}
