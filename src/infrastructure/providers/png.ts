import { inflateSync } from "node:zlib";

/**
 * Decodificador PNG mínimo para las teselas de terreno (terrain-RGB): 8 bits
 * por canal, RGB o RGBA, sin entrelazado. Evita una dependencia nativa (sharp)
 * en el servidor. Lanza con cualquier otro formato.
 */
export interface DecodedPng {
  width: number;
  height: number;
  /** Canales por píxel (3 o 4). */
  channels: number;
  data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b))
    throw new Error("PNG: firma inválida");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const depth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(
          `PNG: formato no soportado (bits ${depth}, color ${colorType}, entrelazado ${interlace})`,
        );
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (!width || !height || !channels || !idat.length) throw new Error("PNG: faltan datos");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("PNG: datos incompletos");
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x >= channels ? out[row + x - channels]! : 0;
      const b = y > 0 ? out[prev + x]! : 0;
      const c = x >= channels && y > 0 ? out[prev + x - channels]! : 0;
      let r: number;
      switch (filter) {
        case 0:
          r = v;
          break;
        case 1:
          r = v + a;
          break;
        case 2:
          r = v + b;
          break;
        case 3:
          r = v + ((a + b) >> 1);
          break;
        case 4:
          r = v + paeth(a, b, c);
          break;
        default:
          throw new Error(`PNG: filtro ${filter} desconocido`);
      }
      out[row + x] = r & 0xff;
    }
  }
  return { width, height, channels, data: out };
}
