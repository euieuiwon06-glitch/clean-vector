// 배포 전 실행: node tools/stamp.mjs
// 파일 내용 해시를 모든 CSS·JS 주소에 ?v=로 붙여, 브라우저가 예전 캐시 대신 새 파일을 받게 한다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const files = ['index.html', 'styles.css', ...fs.readdirSync('src', { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => path.join('src', f).split(path.sep).join('/'))];
const strip = (s) => s.replace(/(\.(?:js|css))\?v=[0-9a-f]+/g, '$1');
const h = crypto.createHash('sha1');
for (const f of files) h.update(strip(fs.readFileSync(f, 'utf8')));
const v = h.digest('hex').slice(0, 8);
const tag = (s) => strip(s)
  .replace(/(from\s+'\.{1,2}\/[^']+?\.js)'/g, `$1?v=${v}'`)
  .replace(/(new URL\('\.\/[^']+?\.js)'/g, `$1?v=${v}'`)
  .replace(/(href="styles\.css)"/g, `$1?v=${v}"`)
  .replace(/(src="src\/app\.js)"/g, `$1?v=${v}"`);
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8'), t = tag(s);
  if (s !== t) fs.writeFileSync(f, t);
}
console.log('version', v);
