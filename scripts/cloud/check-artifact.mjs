import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root='apps/web/dist-cloud';
const files=[];
function walk(directory,prefix='') {
  for(const item of readdirSync(directory,{withFileTypes:true})) {
    const relative=prefix+item.name;
    if(item.isDirectory()) walk(join(directory,item.name),relative+'/');
    else files.push(relative);
  }
}
walk(root);
for(const path of files) {
  assert.ok(['index.html','_redirects','_headers'].includes(path)||/^assets\/[\w.-]+\.(js|css)$/.test(path)||
    /^decks\/(manifest|cards\.[a-f0-9]+)\.json$/.test(path),`Unexpected public artifact: ${path}`);
  const text=readFileSync(join(root,path),'utf8');
  assert.ok(!/sb_secret_[A-Za-z0-9]{8,}/.test(text),`Secret key in ${path}`);
  assert.ok(!/"role"\s*:\s*"service_role"/.test(text),`Service role payload in ${path}`);
}
assert.ok(files.includes('_redirects')&&files.includes('_headers'));
assert.ok(files.includes('decks/manifest.json'));
console.log(`Cloud artifact allowlist passed: ${files.length} files; only UI and public deck.`);
