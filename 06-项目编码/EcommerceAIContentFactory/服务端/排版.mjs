import sharp from 'sharp';

const xml = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));

export function wrapText(text, maxUnits, maxLines) {
  const lines = []; let line = ''; let width = 0;
  for (const character of Array.from(text || '')) {
    const unit = /[\u0000-\u00ff]/.test(character) ? 0.55 : 1;
    if (character === '\n' || width + unit > maxUnits) { lines.push(line); line = ''; width = 0; }
    if (character !== '\n') { line += character; width += unit; }
  }
  if (line) lines.push(line);
  const result = lines.slice(0, maxLines);
  if (lines.length > maxLines) result[result.length - 1] = result.at(-1).slice(0, -1) + '…';
  return result;
}

export function fitText(text, maxWidth, maxHeight, initialSize) {
  for (let size = initialSize; size >= 12; size--) {
    const lines = wrapText(text, maxWidth / size, Infinity);
    const lineHeight = Math.ceil(size * 1.25);
    if (lines.length * lineHeight <= maxHeight) return { lines, size, lineHeight };
  }
  throw new Error('排版文字过长，请缩短内容。');
}

export async function renderScreen(imagePath, screen, index) {
  const width = 900; const height = 1200;
  const photo = await sharp(imagePath).resize(804, 665, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
  const title = fitText(screen.title, 804, 125, 46);
  const copy = fitText(screen.copy, 804, 255, 27);
  const overlay = `<svg width="900" height="1200" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="1200" fill="#ffffff"/>
    <text x="48" y="54" font-size="20" font-family="Microsoft YaHei, sans-serif" fill="#697570">${String(index + 1).padStart(2, '0')}</text>
    ${title.lines.map((line, n) => `<text x="48" y="${82 + title.size + n * title.lineHeight}" font-size="${title.size}" font-weight="600" font-family="Microsoft YaHei, sans-serif" fill="#202827">${xml(line)}</text>`).join('')}
    ${copy.lines.map((line, n) => `<text x="48" y="${913 + copy.size + n * copy.lineHeight}" font-size="${copy.size}" font-family="Microsoft YaHei, sans-serif" fill="#414d47">${xml(line)}</text>`).join('')}
  </svg>`;
  return sharp(Buffer.from(overlay)).composite([{ input: photo, left: 48, top: 225 }]).png().toBuffer();
}

export async function renderLongImage(paths) {
  const inputs = await Promise.all(paths.map(file => sharp(file).resize({ width: 900 }).png().toBuffer()));
  const heights = await Promise.all(inputs.map(buffer => sharp(buffer).metadata().then(m => m.height)));
  let top = 0;
  const composite = inputs.map((input, index) => { const item = { input, top, left: 0 }; top += heights[index]; return item; });
  return sharp({ create: { width: 900, height: top, channels: 3, background: '#ffffff' } }).composite(composite).png().toBuffer();
}
