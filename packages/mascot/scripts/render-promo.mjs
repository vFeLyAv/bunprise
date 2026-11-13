// Records a promo clip of the mascot gallery (packages/mascot/demo/promo, docs/design/2026-10-25-promo-video-plan.md)
// into a real video file: every frame is SEEKED on the clip's timeline (window.promoFilm.seek) and screenshotted,
// so no frame is dropped or doubled; the soundtrack is rendered by the page itself (OfflineAudioContext, the same
// synth as the preview); ffmpeg puts both together.
//
//   node packages/mascot/scripts/render-promo.mjs --clip main --out media/video/bunprise-promo.mp4
//        [--fps 30] [--scale 3] [--no-music] [--silent] [--loop] [--gif media/gif/x.gif --gif-width 640 --gif-fps 15]
//
//   --silent  an MP4 without an audio track (the 16:9 banners: Telegram plays MP4 animations silently)
//   --loop    a seamless loop: the frame at t = duration is the frame at t = 0, so it is left out (no stutter)
//
// What was rendered 25.10 (all into the git-ignored media/ folder):
//   main:            --clip main --scale 3 --out media/video/bunprise-promo-1080x1920.mp4
//   install clips:   --clip install-ios|install-android --scale 3 --out media/video/bunprise-install-<os>-1080x1920.mp4
//   16:9 banners:    --clip banner-brand|banner-secret|banner-dream --scale 2 --fps 25 --loop --silent
//                    --out media/gif/bunprise-<name>-1280x720.mp4 --gif media/gif/bunprise-<name>-640x360.gif --gif-fps 20
//
// Needs the gallery on http://localhost:5180 (npx vite --port 5180 in packages/mascot) and ffmpeg on PATH.
// Frames go to the OS temp folder and are deleted afterwards. media/ is git-ignored (big files).
import { firefox } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const clip = opt('clip', 'main');
const out = opt('out', null);
const gif = opt('gif', null);
const fps = Number(opt('fps', '30'));
const scale = Number(opt('scale', '3'));
const music = !args.includes('--no-music');
const silent = args.includes('--silent');
const loop = args.includes('--loop');
const gifWidth = Number(opt('gif-width', '640'));
const gifFps = Number(opt('gif-fps', '15'));
if (!out && !gif) throw new Error('give --out <file.mp4> and/or --gif <file.gif>');

const work = join(tmpdir(), `bunprise-render-${clip}-${Date.now()}`);
mkdirSync(work, { recursive: true });
const browser = await firefox.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: scale });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`http://localhost:5180/?screens=film&clip=${clip}&t=0&zoom=1&autoplay=0&render=1`);
  await page.waitForFunction(() => Boolean(window.promoFilm));
  await page.waitForTimeout(800);
  const duration = await page.evaluate(() => window.promoFilm.duration);
  const stage = page.locator('.pf-stage');
  const frames = Math.round(duration * fps);
  const last = loop ? frames - 1 : frames;
  const started = Date.now();
  for (let i = 0; i <= last; i++) {
    // seek, then wait two animation frames so the compositor has painted that moment
    await page.evaluate((t) => new Promise((done) => {
      window.promoFilm.seek(t);
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    }), Math.min(duration, i / fps));
    await stage.screenshot({ path: join(work, `${String(i).padStart(5, '0')}.png`) });
    if (i % 150 === 0) console.log(`frame ${i}/${last} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
  if (problems.length) throw new Error(`page errors: ${problems.join(' | ')}`);
  const pattern = join(work, '%05d.png');
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    const video = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-profile:v', 'high', '-movflags', '+faststart'];
    if (silent) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', pattern, ...video, '-an', resolve(out)], { stdio: 'inherit' });
    } else {
      const wav = join(work, 'sound.wav');
      const base64 = await page.evaluate((m) => window.promoFilm.soundtrack({ music: m }), music);
      writeFileSync(wav, Buffer.from(base64, 'base64'));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', pattern, '-i', wav,
        ...video, '-c:a', 'aac', '-b:a', '192k', '-shortest', resolve(out)], { stdio: 'inherit' });
    }
    console.log(`video: ${resolve(out)}`);
  }
  if (gif) {
    mkdirSync(dirname(resolve(gif)), { recursive: true });
    const filter = `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', pattern, '-vf', filter, '-loop', '0', resolve(gif)], { stdio: 'inherit' });
    console.log(`gif: ${resolve(gif)}`);
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
