import fs from 'node:fs';

const source = new URL('../docs/store/privacy-policy.zh-CN.md', import.meta.url);
const policy = fs.readFileSync(source, 'utf8').trim();
if (policy.includes('【填写')) throw new Error('Complete publisher and contact information before publishing.');
const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const blocks = policy.split(/\r?\n\s*\r?\n/).map(block => {
  const heading = block.match(/^(#{1,3}) (.+)$/);
  if (heading) return '<h' + heading[1].length + '>' + escape(heading[2]) + '</h' + heading[1].length + '>';
  return '<p>' + escape(block).replace(/\r?\n/g, '<br>') + '</p>';
}).join('\n');
const html = '<!doctype html>\n' + [
  '<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="color-scheme" content="light"><meta name="description" content="bili直播融合姬隐私政策：直播、弹幕、登录信息与本机保存的处理说明。">',
  '<title>bili直播融合姬 · 隐私政策</title><link rel="icon" href="store/logo-300.png" type="image/png">',
  '<style>',
  '*{box-sizing:border-box}body{margin:0;background:#f3f8f5;color:#334d40;font:16px/1.9 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}header{max-width:900px;margin:44px auto 22px;padding:0 26px;display:flex;align-items:center;gap:12px}header img{border-radius:12px}header strong{font-size:17px}header span{display:block;color:#7f9487;font-size:12px}main{max-width:900px;margin:0 auto 30px;padding:38px 48px 45px;background:#fff;border:1px solid #e0ebe4;border-radius:20px;box-shadow:0 8px 36px #244c3410}h1{margin:0 0 24px;color:#24563d;font-size:28px;line-height:1.4}h2{margin:34px 0 12px;padding-top:24px;border-top:1px solid #edf2ef;font-size:19px;color:#2f684a}p{margin:14px 0;overflow-wrap:anywhere}main>p:nth-of-type(-n+3){color:#84988b;font-size:14px}footer{max-width:900px;margin:0 auto 40px;padding:0 26px;color:#84988b;font-size:13px}a{color:#32744d;text-underline-offset:4px}a:focus-visible{outline:2px solid #418760;outline-offset:4px}@media(max-width:600px){header{margin-top:24px;padding:0 20px}main{margin:0 12px 24px;padding:26px 22px;border-radius:14px}h1{font-size:23px}h2{font-size:18px}body{font-size:15px}footer{padding:0 22px}}',
  '</style></head><body>',
  '<header><img src="store/logo-300.png" alt="" width="44" height="44"><div><strong>bili直播融合姬</strong><span>把喜欢的两个现场，融在一起</span></div></header>',
  '<main>' + blocks + '</main>',
  '<footer>发布者：PeanutJelly · <a href="https://github.com/CrystalCrack/bili-live-fusion">项目源码</a></footer>',
  '</body></html>'
].join('\n');
fs.writeFileSync(new URL('../docs/index.html', import.meta.url), html + '\n');
fs.writeFileSync(new URL('../docs/.nojekyll', import.meta.url), '');
console.log('Built docs/index.html from the current privacy policy.');
