/* full check of the snippet: every view, every action, overlays in view, hover keeps our look,
   and the hostile-theme page must render like the plain page (same sizes/colours of key parts) */
const {chromium}=require('playwright');const S=process.argv[2];
const VIEWS=['subs','lic','dom','orders','profile'];
const fails=[];const ok=m=>{};const bad=(m)=>fails.push(m);
async function snapshot(p){return p.evaluate(()=>{const sel=['#fsa .shell','#fsa .side','#fsa .main','#fsa .h1','#fsa .sub','#fsa .tabs','#fsa .tabs button','#fsa .btn-grad','#fsa .tbl','#fsa .tbl thead th','#fsa .tbl tbody td','#fsa .tbl tbody td:nth-child(2)','#fsa .tbl tbody td:last-child','#fsa .ibtn','#fsa .dl','#fsa .btn.dl-sm','#fsa .plan','#fsa .plan .name','#fsa .chip','#fsa input','#fsa label','#fsa .fp-btn','#fsa .side button','#fsa .hint','#fsa a','#fsa .hello','#fsa .ltag','#fsa .fname','#fsa .src','#fsa .site-n','#fsa .h2-sec','#fsa .lock-note','#fsa .usage','#fsa .orow td','#fsa .prefs'];
 const o={};for(const s of sel){const e=document.querySelector(s);if(!e)continue;const r=e.getBoundingClientRect(),c=getComputedStyle(e);const sh=document.querySelector('#fsa .shell').getBoundingClientRect();const vis=r.width>0||r.height>0;o[s]={x:vis?Math.round(r.right-sh.right):'hidden',y:vis?Math.round(r.top-sh.top):'hidden',w:Math.round(r.width),h:Math.round(r.height),ta:c.textAlign,lh:c.lineHeight,td:c.textDecorationLine,ls:c.letterSpacing,mg:c.margin,fw:c.fontWeight,bg:c.backgroundColor+'|'+c.backgroundImage.slice(0,30),col:c.color,font:c.fontSize+' '+c.fontFamily.split(',')[0],bd:c.borderTopWidth+' '+c.borderTopColor,pad:c.padding,tt:c.textTransform}}return o})}
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
for(const w of [390,1280]){
 const pages={};
 for(const v of ['plain','theme']){const p=await b.newPage({viewport:{width:w,height:800}});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/ERR_|net::|Failed to load/.test(m.text()))errs.push(m.text())});
  await p.goto('file://'+S+'/page-'+v+'.html');await p.waitForTimeout(500);pages[v]={p,errs,snap:{}};
  for(const vw of VIEWS){await p.evaluate(x=>document.querySelector(`#fsa .side button[data-view="${x}"]`).click(),vw);await p.waitForTimeout(500);
   pages[v].snap[vw]=await snapshot(p);
   const ov=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(ov>1)bad(`${w} ${v} ${vw}: page scrolls sideways by ${ov}px`);
   if(v==='theme')await p.screenshot({path:`${S}/suite-${w}-${vw}.png`,fullPage:false});
  }
  await p.evaluate(()=>{document.querySelector('#fsa .side button[data-view="subs"]').click()});await p.waitForTimeout(300);
  await p.evaluate(()=>document.querySelector('#fsa [data-subtab="reg"]').click());await p.waitForTimeout(400);pages[v].snap.reg=await snapshot(p);
 }
 // theme page must look like the plain page
 for(const vw of [...VIEWS,'reg'])for(const [s,a] of Object.entries(pages.plain.snap[vw])){const t=pages.theme.snap[vw][s];if(!t){bad(`${w} ${vw}: ${s} missing under theme`);continue}
  for(const k of Object.keys(a)){if(k==='font'&&a[k].split(' ')[0]===t[k].split(' ')[0])continue;if(['x','y','w','h'].includes(k)&&typeof a[k]==='number'&&Math.abs(a[k]-t[k])<=1)continue;if(String(a[k])!==String(t[k]))bad(`${w} ${vw} ${s} ${k}: plain=${a[k]} theme=${t[k]}`)}}
 // actions on the theme page, scrolled down
 const p=pages.theme.p;
 const inView=async sel=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return 'missing';const r=e.getBoundingClientRect();return r.top>=-1&&r.bottom<=innerHeight+1&&r.height>0?true:`${Math.round(r.top)}..${Math.round(r.bottom)} of ${innerHeight}`},sel);
 const toastNow=async()=>{await p.waitForTimeout(260);return p.evaluate(()=>{const t=document.querySelector('#toast');return t.classList.contains('show')?t.textContent:''})};
 const go=async vw=>{await p.evaluate(x=>document.querySelector(`#fsa .side button[data-view="${x}"]`).click(),vw);await p.waitForTimeout(450);await p.evaluate(()=>scrollTo(0,document.querySelector('#fsa .main').getBoundingClientRect().top+scrollY+200));await p.waitForTimeout(150)};
 await go('lic');
 const pops=await p.locator('#fsa .pop button.ibtn[data-pop]').count();
 if(pops){await p.locator('#fsa .pop button.ibtn[data-pop]').first().click();await p.waitForTimeout(300);
  const labels=await p.locator('#fsa .pop-menu [data-cert]').allInnerTexts();if(new Set(labels).size!==labels.length)bad(`${w} cert menu has identical labels: ${labels}`);
  await p.locator('#fsa .pop-menu [data-cert]').nth(1).click();await p.waitForTimeout(600);
  const iv=await inView('#certModal .sheet-bar');if(iv!==true)bad(`${w} certificate opens off screen (${iv})`);
  const name=await p.evaluate(()=>document.querySelector('#certBody').innerText.includes('דיסקברי'));if(!name)bad(`${w} certificate shows the wrong font`);
  await p.evaluate(()=>document.querySelector('#certModal [data-t]').click());const tt=await toastNow();if(!tt.includes('בשלב הבא'))bad(`${w} PDF button gives no message (${tt})`);
  if(await inView('#toast')!==true)bad(`${w} message off screen`);
  await p.evaluate(()=>document.querySelector('#certClose').click());await p.waitForTimeout(450);
  if(!(await p.evaluate(()=>document.querySelector('#certModal').hidden)))bad(`${w} certificate does not close`);}
 else bad(`${w} no multi-licence row to test`);
 // single cert button
 await p.locator('#fsa .acts > button.ibtn[data-cert]').first().click();await p.waitForTimeout(600);if(await inView('#certModal .sheet-bar')!==true)bad(`${w} single certificate off screen`);
 await p.keyboard.press('Escape');await p.waitForTimeout(400);
 if(!(await p.evaluate(()=>document.querySelector('#certModal').hidden)))await p.evaluate(()=>document.querySelector('#certClose').click()),await p.waitForTimeout(400);
 // download menu items are real links
 const dlm=await p.locator('#fsa .pop button.btn.dl-sm[data-pop]').count();if(dlm){await p.locator('#fsa .pop button.btn.dl-sm[data-pop]').first().click();await p.waitForTimeout(300);const hrefs=await p.locator('#fsa .pop-menu a[href]').evaluateAll(a=>a.map(x=>x.getAttribute('href')));if(!hrefs.length||hrefs.some(h=>!/^https?:/.test(h)))bad(`${w} download menu links ${hrefs}`);await p.keyboard.press('Escape');await p.mouse.click(5,5)}
 // domain actions -> "next stage" message, nothing changes
 await go('dom');const rows0=await p.locator('#fsa .dom-tbl tbody tr').count();
 for(const a of ['[data-edit]','[data-del]']){await p.evaluate(s=>document.querySelector('#fsa '+s).click(),a);const t=await toastNow();if(!t.includes('בשלב הבא'))bad(`${w} ${a} gives "${t}"`);if(await inView('#toast')!==true)bad(`${w} toast off screen after ${a}`)}
 if(await p.locator('#fsa .dom-tbl tbody tr').count()!==rows0||await p.locator('#fsa tr.editing').count())bad(`${w} domain rows changed`);
 // registration
 await go('subs');await p.evaluate(()=>document.querySelector('#fsa [data-subtab="reg"]').click());await p.waitForTimeout(400);
 const ro=await p.locator('#fsa [data-regopen]').isVisible();if(ro){await p.click('#fsa [data-regopen]');await p.waitForTimeout(600)}
 await p.fill('#sd2','x.co.il');await p.click('#fsa .reg-add');const rt=await toastNow();if(!rt.includes('בשלב הבא'))bad(`${w} register gives "${rt}"`);
 // hover/focus keep our button look
 for(const s of ['#fsa .reg-add','#fsa .plan-tg','#fsa .tabs button']){const el=p.locator(s).first();const before=await el.evaluate(e=>getComputedStyle(e).backgroundImage+getComputedStyle(e).backgroundColor);await el.hover();await p.waitForTimeout(350);const after=await el.evaluate(e=>{const c=getComputedStyle(e);return c.backgroundImage+c.backgroundColor+'|'+c.color});if(/rgb\(0, 0, 204\)|255, 255, 0/.test(after))bad(`${w} ${s} takes the theme hover colour`);if(s==='#fsa .reg-add'&&!after.includes('gradient'))bad(`${w} ${s} loses its gradient on hover`)}
 // weight picker: real weights, each with its own links, menu stays inside the screen
 await go('subs');await p.evaluate(()=>document.querySelector('#fsa [data-subtab="dl"]').click());await p.waitForTimeout(400);
 const wb=p.locator('#fsa .wsel').last();if(!(await wb.count()))bad(`${w} no weight picker`);else{await wb.scrollIntoViewIfNeeded();await wb.click();await p.waitForTimeout(400);
  const rows=await p.locator('#fsa .pop.open .wrow').count();if(rows<2)bad(`${w} weight menu rows: ${rows}`);
  const links=await p.locator('#fsa .pop.open .wrow a.wdl').evaluateAll(a=>a.map(x=>x.getAttribute('href')));if(!links.length||links.some(h=>!/fsa_wdl=/.test(h)))bad(`${w} weight links ${links.slice(0,3)}`);
  const box=await p.locator('#fsa .pop.open .wsel-menu').boundingBox();if(!box||box.x<0||box.x+box.width>w+1)bad(`${w} weight menu leaves the screen ${JSON.stringify(box)}`);
  const clip=await p.evaluate(()=>{const m=document.querySelector('#fsa .pop.open .wsel-menu').getBoundingClientRect(),sh=document.querySelector('#fsa .shell').getBoundingClientRect();return m.bottom<=sh.bottom+1&&m.top>=sh.top-1});if(!clip)bad(`${w} weight menu is cut by the panel`);
  await p.screenshot({path:`${S}/weights-${w}.png`});await p.keyboard.press('Escape');await p.mouse.click(5,5);await p.waitForTimeout(200)}
 const hdr=await p.evaluate(()=>[...document.querySelectorAll('#fsa .dl-tbl thead th')].map(t=>t.textContent.trim()));if(w>760&&!hdr.includes('הורדה לפי משקל'))bad(`${w} downloads header ${hdr}`);
 // plan details
 await p.click('#fsa [data-plantg]');await p.waitForTimeout(500);if(!(await p.evaluate(()=>document.querySelector('#fsa .plan').classList.contains('open'))))bad(`${w} plan details don't open`);
 // logout & orders links
 await go('orders');const ol=await p.locator('#fsa .otbl a[href]').evaluateAll(a=>a.map(x=>x.getAttribute('href')));if(!ol.length)bad(`${w} orders have no links`);
 for(const v of ['plain','theme'])if(pages[v].errs.length)bad(`${w} ${v} JS errors: ${pages[v].errs}`);
}
console.log(fails.length?'FAIL\n'+fails.join('\n'):'ALL PASSED');await b.close()})();
