import sharp from "sharp";
import { writeFileSync, readFileSync } from "fs";

const SVG = readFileSync("src/app/icon.svg");
const OUT = "public";

// A real ICO: ICONDIR + one ICONDIRENTRY per size + BMP (DIB) images.
// Safari refuses the PNG-renamed-to-.ico that used to sit here.
function dib(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight — XOR image + AND mask
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // BI_RGB

  // BGRA, bottom-up
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = ((size - 1 - y) * size + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }
  // AND mask: 1bpp, rows padded to 4 bytes. All zero = fully opaque.
  const maskRow = Math.ceil(size / 8 / 4) * 4;
  const mask = Buffer.alloc(maskRow * size);
  return Buffer.concat([header, xor, mask]);
}

const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) {
  const { data } = await sharp(SVG)
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  images.push(dib(data, size));
}

const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // type 1 = icon
dir.writeUInt16LE(sizes.length, 4);

let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size === 256 ? 0 : size, 0);
  e.writeUInt8(size === 256 ? 0 : size, 1);
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});

writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([dir, ...entries, ...images]));

// PNG fallback that Safari happily uses via <link rel="icon" type="image/png">
for (const size of [32, 180]) {
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  await sharp(SVG).resize(size, size).png().toFile(`${OUT}/${name}`);
}

console.log("wrote favicon.ico (16/32/48), icon-32.png, apple-touch-icon.png");
