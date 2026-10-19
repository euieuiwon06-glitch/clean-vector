// 브라우저 확인용: node tools/shot.mjs samples/x.png [mode] [view] [out]
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const [file, mode = 'graphic', view = 'vec', out = 'out/app.png', w = '1440', h = '900'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://127.0.0.1:5333/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
if (mode === 'overlay') await page.click('#mode button[data-v="overlay"]');
const input = await page.$('#file');
await input.uploadFile(path.resolve(file));
await page.waitForFunction(() => !document.querySelector('#save').disabled, { timeout: 120000 });
await page.click(`#view button[data-v="${view}"]`);
if (process.env.ZOOM) {
  // ZOOM=화면x,화면y,단계  (마우스 휠로 확대)
  const [zx, zy, n] = process.env.ZOOM.split(',').map(Number);
  await page.mouse.move(zx, zy);
  for (let i = 0; i < n; i++) { await page.mouse.wheel({ deltaY: -120 }); await new Promise((r) => setTimeout(r, 30)); }
}
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: out });
console.log('stats:', await page.$eval('#stats', (e) => e.textContent), errs.length ? '\nERR ' + errs.join('\n') : '');
await browser.close();
