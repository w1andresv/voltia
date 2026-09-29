// Íconos de la PWA a partir de public/favicon.svg (npm run icons).
// Usa sharp, que Next instala para optimizar imágenes; no es una dependencia directa.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
/** Fondo de la app en modo oscuro (theme-color del layout y del manifest). */
const BACKGROUND = "#0c0f12";

const svg = await readFile(new URL("public/favicon.svg", root));

/** El pin a `scale` del lado, centrado, sobre el fondo (o transparente). */
async function icon(size, { scale = 1, background = null } = {}) {
  const inner = Math.round(size * scale);
  const pin = await sharp(svg, { density: 1200 }).resize(inner, inner).png().toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: pin, gravity: "center" }])
    .png()
    .toBuffer();
}

const outputs = [
  ["public/icons/icon-192.png", await icon(192)],
  ["public/icons/icon-512.png", await icon(512)],
  // Android recorta los "maskable" a un círculo o gota: el pin va dentro de la zona segura (80 %).
  ["public/icons/icon-maskable-512.png", await icon(512, { scale: 0.62, background: BACKGROUND })],
  // iOS no admite transparencia en el ícono de inicio.
  ["src/app/apple-icon.png", await icon(180, { scale: 0.72, background: BACKGROUND })],
];
for (const [path, png] of outputs) {
  await writeFile(new URL(path, root), png);
  console.log(`✓ ${path}`);
}
