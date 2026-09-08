/** Production-only deterministic captures + relative headless profiling.
 * Build first, serve on 4173, then: node scripts/visual-audit.mjs <output-dir>
 * No image hashes: numerical palette/readability tests remain authoritative.
 */
import { spawn } from 'node:child_process';
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv[2] ?? 'captures/audit');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ ...(existsSync(process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium') ? { executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' } : {}) });
const server = spawn('npm', ['run', 'preview'], {stdio:'ignore'});
await new Promise(resolve => setTimeout(resolve, 1500));
const results = [];
const url = 'http://127.0.0.1:4173/?debug=1&seed=visual-audit';
async function open(profile) {
  const context = await browser.newContext(profile);
  await context.addInitScript(() => {
    let seed = 1234567;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let queue = new Map(), id = 0, now;
    window.requestAnimationFrame = cb => { queue.set(++id, cb); return id; };
    window.cancelAnimationFrame = key => queue.delete(key);
    window.auditAdvance = (frames = 1) => {
      now ??= window.performance.now();
      const renderer = window.__refraction?.renderer.renderer;
      const draw = renderer?.render;
      for (let i = 0; i < frames; i++) {
        if (renderer) renderer.render = i === frames - 1 ? draw : () => {};
        now += 1000 / 60;
        const pending = queue; queue = new Map();
        for (const cb of pending.values()) cb(now);
      }
    };
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('#app[data-ready="true"]');
  return {context, page};
}
async function advance(page, frames = 1) { await page.evaluate(n => window.auditAdvance(n), frames); }
async function shot(page, name) {
  await page.screenshot({path: resolve(out, `${name}.png`), timeout:120000});
  console.log(name);
}
async function setup(page, mode = 'ascent', height = 0, buried = false) {
  await page.evaluate(({mode, height, buried}) => {
    const h = window.__refraction; h.play(mode, 'visual-audit'); h.renderer.setPeek(false);
    const g = h.game; g.board.clearAll();
    for (let y = 0; y < height; y++) for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
      if ((x * 3 + z * 5 + y) % 7 < 4) g.board.fill({x, y, z});
    }
    if (buried) for (let y=0;y<12;y++) for(let z=1;z<8;z++) for(let x=2;x<6;x++) g.board.fill({x,y,z});
    g.active = { id:'O', offsets:[{x:0,y:0,z:0},{x:1,y:0,z:0},{x:0,y:1,z:0},{x:1,y:1,z:0}], u:3,y:15,lane:buried?7:3 };
    g.status = 'paused';
  }, {mode,height,buried});
  await advance(page, 60);
}
async function metric(page, name) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  const data = await page.evaluate((name) => {
    const h=window.__refraction, r=h.renderer;
    const gl=r.renderer.getContext(); let uploads=0, bytes=0;
    const original=gl.bufferSubData.bind(gl);
    gl.bufferSubData=(...args)=>{ uploads++; bytes+=args[4] ? args[4]*args[2].BYTES_PER_ELEMENT : args[2]?.byteLength??0; return original(...args); };
    const times=[], draws=[]; const info=r.renderer.info; info.autoReset=false;
    for(let i=0;i<90;i++) { info.reset(); const start=window.performance.now(); r.render(h.game, name === 'turn' ? 0 : 1000/60); times.push(window.performance.now()-start); draws.push({...info.render}); }
    gl.bufferSubData=original; info.autoReset=true;
    times.sort((a,b)=>a-b);
    return { cpuRenderMs:{p50:times[45],p95:times[85],max:times[89]}, drawCalls:draws[45].calls, triangles:draws[45].triangles, geometries:info.memory.geometries, textures:info.memory.textures, uploadsPerFrame:uploads/90, uploadBytesPerFrame:bytes/90, well:r.wellScreenRect(), gpu:gl.getParameter(gl.RENDERER) };
  }, name);
  const after = await cdp.send('Performance.getMetrics');
  const values=x=>Object.fromEntries(x.metrics.map(m=>[m.name,m.value]));
  const a=values(after), b=values(before);
  results.push({name,...data,scriptMs:(a.ScriptDuration-b.ScriptDuration)*1000,taskMs:(a.TaskDuration-b.TaskDuration)*1000,heapDelta:a.JSHeapUsedSize-b.JSHeapUsedSize});
  writeFileSync(resolve(out,'metrics.json'),JSON.stringify(results,null,2));
  console.log(name, JSON.stringify(results.at(-1)));
  await cdp.detach();
}
try {
  const {page,context}=await open({viewport:{width:1440,height:900},deviceScaleFactor:1});
  if (!process.env.AUDIT_TAIL) {
  await advance(page); await shot(page,'desktop-boot');
  await page.getByRole('button',{name:'TAP TO PLAY',exact:true}).click({force:true}); await advance(page,60); await shot(page,'desktop-title'); await metric(page,'title');
  await page.getByRole('button',{name:'PLAY',exact:true}).click({force:true}); await shot(page,'desktop-modes');
  await page.getByRole('button',{name:'Back',exact:true}).click({force:true});
  await page.getByRole('button',{name:'SETTINGS',exact:true}).click({force:true}); await shot(page,'desktop-settings');
  await setup(page); await shot(page,'desktop-fresh'); await metric(page,'falling');
  await setup(page,'ascent',5); await shot(page,'desktop-stacked');
  await setup(page,'ascent',15); await shot(page,'desktop-dense'); await metric(page,'dense');
  await setup(page,'ascent',7,true); await shot(page,'desktop-buried'); await metric(page,'xray');
  await page.evaluate(()=>window.__refraction.renderer.setPeek(true)); await advance(page,12); await shot(page,'desktop-peek'); await metric(page,'peek');
  await setup(page,'ascent',8);
  await page.evaluate(()=>{const g=window.__refraction.game;g.status='awaitingTurn';g.shiftMeter=g.stage.linesPerTurn;}); await advance(page); await shot(page,'desktop-shift');
  await page.keyboard.press('ArrowRight'); await advance(page,10); await shot(page,'desktop-turn-early'); await advance(page,12); await shot(page,'desktop-turn-mid');
  await advance(page,12); await shot(page,'desktop-turn-late'); await advance(page,30); await shot(page,'desktop-new-face');
  await setup(page,'ascent',8); await page.evaluate(()=>{const h=window.__refraction;h.renderer.startTurn('right');h.renderer.turnElapsed=375;}); await metric(page,'turn');
  await page.evaluate(()=>{window.__refraction.renderer.turnDurationMs=750;window.__refraction.renderer.snapToFace('front');});
  for(const event of ['lock','clear-glow','clear-debris','refraction','prism','collapse-ready','collapse']) {
    await setup(page,'ascent',7);
    await page.evaluate(event=>{const h=window.__refraction,r=h.renderer,g=h.game;
      if(event==='lock') r.lockFlash([{x:3,y:7,z:4},{x:4,y:7,z:4}]);
      if(event==='clear-glow'){g.status='resolving';g.clearingLines=[{y:3,lane:3}];}
      if(event==='clear-debris'||event==='refraction')r.clearEffect([{y:3,lane:3}],g.face,event==='refraction',false);
      if(event==='prism')r.startPrism();
      if(event==='collapse-ready')g.heat=1;
      if(event==='collapse')r.startCollapse();
    },event);
    await advance(page,event==='prism'?12:3); await shot(page,`desktop-${event}`);
    if(['clear-glow','prism','collapse'].includes(event)) await metric(page,event);
  }
  }
  await setup(page,'ascent',8); await page.evaluate(()=>window.__refraction.game.status='falling'); await page.keyboard.press('Escape'); await advance(page); await shot(page,'desktop-pause');
  await setup(page,'ascent',16); await page.evaluate(()=>{window.__refraction.game.active=null;window.__refraction.game.status='gameOver';}); await advance(page,120); await shot(page,'desktop-game-over');
  await setup(page,'blindSpectrum',8); await shot(page,'desktop-blind');
  await page.goto(url); await page.waitForSelector('#app[data-ready="true"]'); await page.getByRole('button',{name:'TAP TO PLAY',exact:true}).click({force:true}); await page.getByRole('button',{name:'TUTORIAL',exact:true}).click({force:true}); await advance(page,45); await shot(page,'desktop-tutorial');
  await context.close();
  for(const orientation of ['portrait','landscape']) {
    const {page,context}=await open({...devices['Pixel 7'],viewport:orientation==='portrait'?{width:412,height:839}:{width:863,height:360},deviceScaleFactor:1});
    for(const mode of ['flatland','ascent']) { await setup(page,mode,5); await shot(page,`${orientation}-${mode}`); await metric(page,`${orientation}-${mode}`); }
    await setup(page,'ascent',15);await shot(page,`${orientation}-dense`);
    await setup(page,'ascent',7,true);await shot(page,`${orientation}-xray`);
    await page.evaluate(()=>window.__refraction.renderer.startTurn('right'));await advance(page,22);await shot(page,`${orientation}-turn`);
    await setup(page);await page.evaluate(()=>window.__refraction.game.status='falling');await page.keyboard.press('Escape');await advance(page);await shot(page,`${orientation}-pause`);
    await page.getByRole('button',{name:'SETTINGS',exact:true}).click({force:true});await shot(page,`${orientation}-settings`);
    await context.close();
  }
} finally { writeFileSync(resolve(out,'metrics.json'),JSON.stringify(results,null,2)); await browser.close(); server.kill(); }
