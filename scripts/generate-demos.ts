// Generates before/after demos of the local NAFNet Refine tool.
// Each sample is degraded with a synthetic motion blur, sent through the same
// /api/photo-ai route the studio's Refine button uses, and scored with PSNR
// against the sharp original. Output: demos/index.html plus the images.
//
// Usage: bun scripts/generate-demos.ts [--api http://localhost:3000]
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "demos");
const apiArg = process.argv.indexOf("--api");
const api = apiArg > -1 ? process.argv[apiArg + 1] : "http://localhost:3000";
const maxSide = 768;

type Sample = { id: string; file: string; title: string; blur: { length: number; angle: number } | null };
const samples: Sample[] = [
  // Only true photographs here: the film-reel and sneaker assets are halftone-dithered art,
  // which is far outside NAFNet's GoPro training data and produces noise instead of a repair.
  { id: "lego-tilted", file: "lego-kit-original-tilted.png", title: "Tilted submission, horizontal shake", blur: { length: 13, angle: 0 } },
  { id: "lego-kit", file: "lego-kit-rotated-fit.jpg", title: "Model kit, diagonal shake", blur: { length: 11, angle: 45 } },
  { id: "bag-detail", file: "bag-detail-refined.webp", title: "Parts bag close-up, vertical shake", blur: { length: 9, angle: 90 } },
  { id: "bag-real", file: "bag-detail-before.webp", title: "Real customer photo (no synthetic blur)", blur: null },
];

// Line kernel of given length and angle, normalised to sum 1.
function motionKernel(length: number, angle: number) {
  const size = length % 2 ? length : length + 1;
  const k = new Array(size * size).fill(0);
  const c = (size - 1) / 2, rad = (angle * Math.PI) / 180;
  for (let t = -c; t <= c; t += 0.25) {
    const x = Math.round(c + t * Math.cos(rad)), y = Math.round(c - t * Math.sin(rad));
    k[y * size + x] = 1;
  }
  const sum = k.reduce((a, b) => a + b, 0);
  return { width: size, height: size, kernel: k.map(v => v / sum) };
}

async function rgb(buffer: Buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function psnr(a: Buffer, b: Buffer) {
  const [x, y] = await Promise.all([rgb(a), rgb(b)]);
  if (x.width !== y.width || x.height !== y.height) throw new Error("Size mismatch while scoring");
  // Ignore a border the width of the blur kernel, where edge padding dominates.
  const m = 12;
  let se = 0, n = 0;
  for (let row = m; row < x.height - m; row++) for (let col = m; col < x.width - m; col++) {
    const i = (row * x.width + col) * 3;
    for (let ch = 0; ch < 3; ch++) { const d = x.data[i + ch] - y.data[i + ch]; se += d * d; n++; }
  }
  return 10 * Math.log10((255 * 255) / (se / n));
}

async function refine(png: Buffer, name: string) {
  const body = new FormData();
  body.set("image", new File([new Uint8Array(png)], name, { type: "image/png" }));
  body.set("tool", "deblur");
  const started = performance.now();
  const res = await fetch(`${api}/api/photo-ai`, { method: "POST", body, headers: { origin: api } });
  if (!res.ok) throw new Error(`Refine failed (${res.status}): ${await res.text()}`);
  return { image: Buffer.from(await res.arrayBuffer()), seconds: (performance.now() - started) / 1000 };
}

const health = await fetch(`${api}/api/photo-ai`).then(r => r.json()).catch(() => null);
if (!health?.deblur) {
  console.error(`Refine is offline at ${api}. Start the studio with \`bun run dev\` after \`bun run ai:setup\`.`);
  process.exit(1);
}
await mkdir(out, { recursive: true });

const rows: string[] = [];
for (const s of samples) {
  const original = await sharp(resolve(root, "public/images", s.file))
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).removeAlpha().png().toBuffer();
  const input = s.blur
    ? await sharp(original).convolve(motionKernel(s.blur.length, s.blur.angle)).png().toBuffer()
    : original;
  const { image: output, seconds } = await refine(input, `${s.id}.png`);
  await Promise.all([
    writeFile(resolve(out, `${s.id}-original.png`), original),
    writeFile(resolve(out, `${s.id}-input.png`), input),
    writeFile(resolve(out, `${s.id}-refined.png`), output),
  ]);
  let score = "No ground truth: real submission, judge by eye.";
  if (s.blur) {
    const [before, after] = await Promise.all([psnr(original, input), psnr(original, output)]);
    score = `PSNR vs sharp original: blurred ${before.toFixed(2)} dB, refined ${after.toFixed(2)} dB (${after - before >= 0 ? "+" : ""}${(after - before).toFixed(2)} dB)`;
  }
  const { width, height } = await sharp(input).metadata();
  console.log(`${s.id}: ${width}x${height}, ${seconds.toFixed(1)} s. ${score}`);
  rows.push(`<section>
  <h2>${s.title}</h2>
  <p>${width} × ${height} px · ${seconds.toFixed(1)} s on CPU · ${score}</p>
  <div class="cmp" style="--pos:50%">
    <img src="${s.id}-refined.png" alt="Refined" />
    <img class="before" src="${s.id}-input.png" alt="Input" />
    <span class="tag l">Input</span><span class="tag r">Refined</span>
    <input type="range" min="0" max="100" value="50" aria-label="Compare ${s.title}" oninput="this.parentElement.style.setProperty('--pos', this.value + '%')" />
  </div>
  ${s.blur ? `<details><summary>Sharp original (ground truth)</summary><img src="${s.id}-original.png" alt="Original" /></details>` : ""}
</section>`);
}

await writeFile(resolve(out, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Refine demos</title>
<style>
  :root { --ink:#1d2a24; --paper:#eef1ec; --mute:#5d6b63; }
  body { margin:0; padding:40px 24px; background:var(--paper); color:var(--ink); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:820px; margin:0 auto; }
  h1 { font-size:clamp(28px,5vw,44px); margin:0 0 8px; letter-spacing:-.01em; }
  h2 { font-size:20px; margin:48px 0 4px; }
  p { color:var(--mute); margin:0 0 14px; }
  .cmp { position:relative; border-radius:10px; overflow:hidden; line-height:0; user-select:none; }
  .cmp img { width:100%; display:block; }
  .cmp .before { position:absolute; inset:0; height:100%; object-fit:cover; clip-path:inset(0 calc(100% - var(--pos)) 0 0); }
  .cmp::after { content:""; position:absolute; top:0; bottom:0; left:var(--pos); width:2px; margin-left:-1px; background:#fff; border-radius:2px; pointer-events:none; }
  .cmp input { position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:ew-resize; }
  .tag { position:absolute; top:12px; line-height:1; font-size:13px; font-weight:600; color:#fff; padding:6px 9px; background:rgba(20,30,25,.62); border-radius:6px; pointer-events:none; }
  .tag.l { left:12px; } .tag.r { right:12px; }
  details { margin-top:10px; color:var(--mute); } details img { width:100%; border-radius:10px; margin-top:8px; }
</style></head>
<body><main>
<h1>Local Refine, before and after</h1>
<p>NAFNet GoPro (width 64) running on this laptop's CPU through the studio's <code>/api/photo-ai</code> route. Drag across each photo to compare.</p>
${rows.join("\n")}
</main></body></html>`);
console.log(`Demo page: ${resolve(out, "index.html")}`);
