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
  const DB={lic:{},rows:[["05.10.2026","סטודיו","studio.co.il","פורטו",11],["03.09.2026","ישן","old.co.il","טאלנט",10]],next:20};
  await p.addInitScript(()=>{window.print=()=>{window.__printed=(window.__printed||0)+1}});
  await p.route('https://site.test/pay/**',r=>r.fulfill({contentType:'text/html',body:'<p>pay</p>'}));
  await p.route('**/admin-ajax.php',async r=>{const q=new URLSearchParams(r.request().postData()||'');const op=q.get('op');let ok=true,msg='';
   if(q.get('action')==='fsa_v2_addon'){return r.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:{url:'https://site.test/pay/'+q.get('kind')+'/'+q.get('key')}})})}
   if(q.get('action')==='fsa_v2_lic'){const L=DB.lic[q.get('key')]=DB.lic[q.get('key')]||[];
    if(op==='add'){if(L.length>=3)return r.fulfill({contentType:'application/json',body:JSON.stringify({success:false,data:{message:'כל האתרים של הרישיון רשומים.'}})});L.push(['22.10.2026',q.get('name'),q.get('host'),'n'+L.length])}
    else if(op==='del'){const i=L.findIndex(x=>x[3]===q.get('id'));L.splice(i,1)}
    return r.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:{sites:L,n:3}})})}
   if(op==='add'){if(DB.rows.filter(x=>x[0].endsWith('.10.2026')).length>=3){ok=false;msg='ניצלת את הדומיינים של החודש.'}else DB.rows.unshift(['21.10.2026',q.get('name'),q.get('host'),q.get('fonts'),DB.next++])}
   else if(op==='edit'){const x=DB.rows.find(x=>x[4]==q.get('id'));x[1]=q.get('name');x[2]=q.get('host');x[3]=q.get('fonts')}
   else if(op==='del'){DB.rows=DB.rows.filter(x=>x[4]!=q.get('id'))}
   await r.fulfill({contentType:'application/json',body:JSON.stringify(ok?{success:true,data:{domains:DB.rows}}:{success:false,data:{message:msg}})})});
  p.on('dialog',dl=>dl.accept());
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
 // one certificate per font: a single button, all of the font's weights in it
 if(await p.locator('#fsa .lic-wrap .pop button.ibtn[data-pop]').count())bad(`${w} a certificate menu is still there`);
 const crow=p.locator('#fsa .lic-wrap tbody tr:not(.drawer)').filter({hasText:'אזכור'}).first();
 await crow.locator('button.ibtn[data-cert]').click();await p.waitForTimeout(600);
 const iv=await inView('#certModal .sheet-bar');if(iv!==true)bad(`${w} certificate opens off screen (${iv})`);
 const cb=await p.evaluate(()=>document.querySelector('#certBody').innerText);
 if(!['קל','דמוי מודגש','שחור','דקיק','בינוני'].every(x=>cb.includes(x))||!cb.includes('אזכור'))bad(`${w} certificate does not list all weights`);
 if(cb.includes('26.01.2023'))bad(`${w} certificate shows the made-up demo date`);
 if(!/מספר תעודה\s*FS-L-\d+/.test(cb)||cb.includes('לא בתוקף'))bad(`${w} certificate has no fixed number`);
 if(await p.evaluate(()=>!!document.querySelector('#certBody .cert-head img')))bad(`${w} a purchased-font certificate shows a subscription logo`);
 await p.evaluate(()=>document.querySelector('#certClose').click());await p.waitForTimeout(450);
 if(!(await p.evaluate(()=>document.querySelector('#certModal').hidden)))bad(`${w} certificate does not close`);
 // PDF: the browser's print dialog
 await crow.locator('button.ibtn[data-cert]').click();await p.waitForTimeout(500);await p.evaluate(()=>document.querySelector('#certPdf').click());await p.waitForTimeout(300);
 if(!(await p.evaluate(()=>window.__printed)))bad(`${w} PDF button did not open printing`);
 await p.evaluate(()=>document.querySelector('#certClose').click());await p.waitForTimeout(450);
 // a purchased webfont licence: fixed checkout domain is locked; registering a site works
 const drow=p.locator('#fsa .lic-wrap tbody tr:not(.drawer)').filter({hasText:'אזכור'}).first();
 await drow.locator('button.exp').click();await p.waitForTimeout(700);
 const form=p.locator('#fsa form.lic-form').first();
 if(await form.count()){await form.locator('[data-namefor]').fill('licsite.co.il');await form.locator('button').click();await p.waitForTimeout(600);
  if(!(await p.evaluate(()=>document.querySelector('#fsa .lic-drawer').innerText.includes('licsite.co.il'))))bad(`${w} licence site not registered`);
  if(!(await toastNow()).includes('נרשם'))bad(`${w} no message after licence site`)} else bad(`${w} no licence registration form`);
 await drow.locator('button.exp').click();await p.waitForTimeout(500);
 const trow=p.locator('#fsa .lic-wrap tbody tr:not(.drawer)').filter({hasText:'תניא'}).first();
 await trow.locator('button.exp').click();await p.waitForTimeout(700);
 if(!(await p.locator('#fsa .lic-drawer .ibtn.locked').count()))bad(`${w} the checkout domain is not locked`);
 const ab=p.locator('#fsa .lic-drawer [data-addon]');
 if(await ab.count()){await ab.click();await p.waitForTimeout(500);if(!(await p.locator('#cart:not([hidden])').count()))bad(`${w} add-on cart did not open`);
  const cartTxt=await p.evaluate(()=>document.querySelector('#cartBody').innerText);if(/ויזה|4821/.test(cartTxt))bad(`${w} cart still shows a made-up card`);
  await Promise.all([p.waitForURL('**/pay/**',{timeout:5000}).catch(()=>bad(`${w} add-on did not go to the payment page`)),p.click('#cartPay')]);
  if(!/\/pay\/lic\/6\d\d/.test(p.url()))bad(`${w} payment page is for the wrong item: ${p.url()}`);
  await p.goto('file://'+S+'/page-theme.html');await p.waitForTimeout(500);await go('lic')} else bad(`${w} full licence offers no add-on`);
 // single cert button
 await p.locator('#fsa .acts > button.ibtn[data-cert]').first().click();await p.waitForTimeout(600);if(await inView('#certModal .sheet-bar')!==true)bad(`${w} single certificate off screen`);
 await p.keyboard.press('Escape');await p.waitForTimeout(400);
 if(!(await p.evaluate(()=>document.querySelector('#certModal').hidden)))await p.evaluate(()=>document.querySelector('#certClose').click()),await p.waitForTimeout(400);
 // download menu items are real links
 const dlm=await p.locator('#fsa .pop button.btn.dl-sm[data-pop]').count();if(dlm){await p.locator('#fsa .pop button.btn.dl-sm[data-pop]').first().click();await p.waitForTimeout(300);const hrefs=await p.locator('#fsa .pop-menu a[href]').evaluateAll(a=>a.map(x=>x.getAttribute('href')));if(!hrefs.length||hrefs.some(h=>!/^https?:/.test(h)))bad(`${w} download menu links ${hrefs}`);await p.keyboard.press('Escape');await p.mouse.click(5,5)}
 // subscription domains: edit and remove go to the server; licence sites still wait for stage 2
 await go('dom');
 await p.evaluate(()=>document.querySelector('#fsa .dom-tbl [data-edit^="sd:"]').click());await p.waitForTimeout(250);
 await p.locator('#fsa tr.editing .ed-host').fill('studio-new.co.il');await p.evaluate(()=>document.querySelector('#fsa tr.editing [data-edsave]').click());await p.waitForTimeout(500);
 if(!(await p.evaluate(()=>document.querySelector('#fsa .dom-tbl').innerText.includes('studio-new.co.il'))))bad(`${w} edit was not saved`);
 if(!(await toastNow()).includes('עודכן'))bad(`${w} no message after edit`);
 const before=await p.locator('#fsa .dom-tbl tbody tr').count();
 await p.evaluate(()=>document.querySelector('#fsa [data-sddel]').click());await p.waitForTimeout(500);
 if(await p.evaluate(()=>document.querySelector('#fsa .dom-tbl').innerText.includes('studio-new.co.il')))bad(`${w} remove did not remove`);
 if(await inView('#toast')!==true)bad(`${w} toast off screen after remove`);
 const licEdit=await p.$('#fsa [data-edit^="dom:"]');if(licEdit){await licEdit.click();await p.waitForTimeout(300);
  if(!(await p.locator('#fsa .dom-tbl tr.editing').count()))bad(`${w} a licence site does not open for editing`);
  await p.evaluate(()=>document.querySelector('#fsa tr.editing [data-edcancel]').click());await p.waitForTimeout(300)} else bad(`${w} no editable licence site in the domains list`);
 // registration
 await go('subs');await p.evaluate(()=>document.querySelector('#fsa [data-subtab="reg"]').click());await p.waitForTimeout(400);
 const ro=await p.locator('#fsa [data-regopen]').isVisible();if(ro){await p.click('#fsa [data-regopen]');await p.waitForTimeout(600)}
 await p.fill('#sd2','x.co.il');await p.evaluate(()=>{const f=document.querySelector('#fsa .reg-row .fp-menu input');f.checked=true;f.dispatchEvent(new Event('change',{bubbles:true}))});await p.click('#fsa .reg-add');await p.waitForTimeout(500);const rt=await toastNow();if(!rt.includes('נרשם'))bad(`${w} register gives "${rt}"`);
 if(!(await p.evaluate(()=>document.querySelector('#fsa .sub-reg ~ .tbl-wrap').innerText.includes('x.co.il'))))bad(`${w} registered domain not in the list`);
 const regFonts=await p.evaluate(()=>[...document.querySelectorAll('#fsa .reg-row .fp-menu input')].map(i=>i.value));if(regFonts.join()!=='פורטו,טאלנט,דיסקברי')bad(`${w} font list is not the site's list: ${regFonts}`);
 // hover/focus keep our button look
 if(await p.locator('#fsa [data-regopen]').isVisible()){await p.click('#fsa [data-regopen]');await p.waitForTimeout(600)}
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
 await go('orders');const url0=p.url();const eyes=await p.locator('#fsa .otbl [data-oopen]').count();if(eyes<2)bad(`${w} not every order has the details button (${eyes})`);
 await p.locator('#fsa .otbl [data-oopen]').nth(1).click();await p.waitForTimeout(600);
 if(p.url()!==url0)bad(`${w} order details left the page`);if(!(await p.locator('#fsa .otbl tr.drawer').count()))bad(`${w} order details did not open`);
 if(await p.locator('#fsa .otbl a[href*="/o/"]').count())bad(`${w} a link still leads to the old order page`);
 await go('orders');const ol=await p.locator('#fsa .otbl a[href]').evaluateAll(a=>a.map(x=>x.getAttribute('href')));if(!ol.length)bad(`${w} orders have no links`);
 // no purchased fonts: the empty state with its art and the way to the shop, inside the screen
 // special arrangement: the quota shown includes the extra domains
 {const fs=require('fs');const src=fs.readFileSync(S+'/page-plain.html','utf8').replace('"bonus":0','"bonus":0,"extra":2');fs.writeFileSync(S+'/page-deal.html',src);
  const dp=await b.newPage({viewport:{width:w,height:800}});await dp.goto('file://'+S+'/page-deal.html');await dp.waitForTimeout(400);await dp.evaluate(()=>document.querySelector('#fsa [data-subtab="reg"]').click());await dp.waitForTimeout(400);
  const tx=await dp.evaluate(()=>document.querySelector('#fsa .main').innerText);if(!tx.includes('ניתן לרשום 5 דומיינים בכל חודש')||!/1 מתוך 5/.test(tx))bad(`${w} arrangement quota not shown (${(tx.match(/ניתן לרשום[^.]*|\d מתוך \d/g)||[]).join(' | ')})`);await dp.close()}
 const fs=require('fs');const src=fs.readFileSync(S+'/page-theme.html','utf8');const cut=src.replace(/"lic":\[.*?\],"orders"/s,'"lic":[],"orders"');if(cut===src)bad(`${w} could not empty the purchases for the empty-state check`);fs.writeFileSync(S+'/page-empty.html',cut);
 const ep=await b.newPage({viewport:{width:w,height:800}});const eerr=[];ep.on('pageerror',e=>eerr.push(e.message));await ep.goto('file://'+S+'/page-empty.html');await ep.waitForTimeout(400);
 await ep.evaluate(()=>document.querySelector('#fsa .side button[data-view="lic"]').click());await ep.waitForTimeout(500);
 const le=await ep.evaluate(()=>{const e=document.querySelector('#fsa .lic-empty');if(!e)return null;const r=e.getBoundingClientRect(),a=e.querySelector('.le-art').getBoundingClientRect(),c=e.querySelector('.le-cta');return {l:r.left,r:r.right,art:a.width,href:c&&c.getAttribute('href'),grad:c&&getComputedStyle(c).backgroundImage.includes('gradient'),ov:document.documentElement.scrollWidth-innerWidth}});
 if(!le)bad(`${w} no empty state when nothing was bought`);else{if(le.l<0||le.r>w+1||le.ov>1)bad(`${w} empty state leaves the screen`);if(le.art<150)bad(`${w} empty state art too small (${le.art})`);if(le.href!=='https://example.com/shop')bad(`${w} empty state CTA goes to ${le.href}`);if(!le.grad)bad(`${w} empty state CTA lost its gradient`)}
 if(eerr.length)bad(`${w} empty state JS errors: ${eerr}`);await ep.screenshot({path:`${S}/lic-empty-${w}.png`,fullPage:true});await ep.close();
 for(const v of ['plain','theme'])if(pages[v].errs.length)bad(`${w} ${v} JS errors: ${pages[v].errs}`);
}
console.log(fails.length?'FAIL\n'+fails.join('\n'):'ALL PASSED');await b.close()})();
