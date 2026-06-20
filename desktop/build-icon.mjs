// favicon.svg → icon.ico (Windows exe 아이콘). 웹 파비콘과 동일한 그림 사용.
//   재생성: cd desktop && npm install && npm run icon
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(__dirname, '..', 'client', 'public', 'favicon.svg'));
const sizes = [256, 64, 48, 32, 16];
const pngs = await Promise.all(
  sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
);
const ico = await pngToIco(pngs);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
console.log('icon.ico written:', ico.length, 'bytes');
