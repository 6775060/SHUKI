/* Purchase area in a browser: choose on a font page, order details, payment; plans from the pricing page; the thank-you page.
   Prices must be the store's, the total the sum of the lines, one click = one payment request, focus into the sheet and back,
   no sideways scroll on a phone, no motion with reduced motion, and the hostile theme must not change our look.
   Usage: node buy.js OUTDIR (after php harness-buy.php OUTDIR) */
const {chromium}=require('playwright');const fs=require('fs');const S=process.argv[2];
const fails=[];const bad=m=>fails.push(m);
const ORIGIN='https://site.test';
async function setup(b,w,opt={}){
 const ctx=await b.newContext(Object.assign({viewport:{width:w,height:820}},opt));const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 const R={pay:0,ops:[]};let cart=[];let FB=null;
 await p.route(ORIGIN+'/t/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:fs.readFileSync(S+'/'+r.request().url().split('/t/')[1],'utf8')}));
 await p.route(ORIGIN+'/checkout/**',r=>r.fulfill({contentType:'text/html',body:'<p>checkout</p>'}));
 await p.route(ORIGIN+'/product/**',r=>r.fulfill({contentType:'text/html',body:'<p>old product page</p>'}));
 await p.route(ORIGIN+'/?add-to-cart=*',r=>r.fulfill({contentType:'text/html',body:'<p>old add to cart</p>'}));
 /* the server, as fsa_v2_buy_ajax(): lines priced from the store data the page was given */
 await p.route(ORIGIN+'/wp-admin/admin-ajax.php',async r=>{const q=new URLSearchParams(r.request().postData()||'');const op=q.get('op');R.ops.push(op);
  if(!FB)FB=await p.evaluate(()=>window.FS_BUY);const items=FB.font?FB.font.lics.flatMap(l=>l.items.map(i=>Object.assign({lic:l.label},i))):[];
  if(op==='set'){const pid=+q.get('product');cart=cart.filter(l=>l.pid!==pid);for(const v of (q.get('vids')||'').split(',').filter(Boolean)){const it=items.find(i=>i.vid===+v);cart.push({key:'k'+v,pid,vid:+v,kind:'font',name:FB.font.name,sub:(it.fam?'משפחה מלאה':it.n)+' · רישיון '+it.lic,price:it.price,vat:it.vat,was:it.was||0,qty:1})}}
  if(op==='plan'){const k=q.get('k'),P=FB.plans[k];cart=cart.filter(l=>l.kind!=='plan');cart.push({key:'p'+k,pid:P.id,vid:0,kind:'plan',plan:k,name:P.name,sub:'מתחדש כל חודש'+(P.commit?`, בהתחייבות ל־${P.commit} חודשים`:'')+'. החיוב הבא ב־29.11.2026',price:P.price,vat:P.vat,qty:1})}
  if(op==='del')cart=cart.filter(l=>l.key!==q.get('key'));
  if(op==='pay')R.pay++;
  const data={lines:cart,total:Math.round(cart.reduce((a,l)=>a+l.price,0)*100)/100,vat:Math.round(cart.reduce((a,l)=>a+l.vat,0)*100)/100};if(op==='pay')data.url=ORIGIN+'/checkout/';
  await new Promise(x=>setTimeout(x,op==='pay'?250:40));
  r.fulfill({contentType:'application/json',body:JSON.stringify(op==='pay'&&!cart.length?{success:false,data:{message:'העגלה ריקה.'}}:{success:true,data})})});
 return {ctx,p,errs,R};
}
const ils=n=>'₪'+n.toLocaleString('he-IL',{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2});
const num=s=>+String(s).replace(/[^\d.]/g,'');
async function look(p){return p.evaluate(()=>{const o={};for(const s of ['#buyModal .sheet','#buyModal .sheet-bar','#buyModal .tabs button','#buyModal .tabs button[aria-selected="true"]','#buyModal .offer','#buyModal .of-name','#buyModal .of-top','#buyModal .chips button','#buyModal .buy-foot','#buyModal .buy-foot .btn-grad','#buyModal .ibtn']){const e=document.querySelector(s);if(!e)continue;const r=e.getBoundingClientRect(),c=getComputedStyle(e);o[s]={w:Math.round(r.width),h:Math.round(r.height),font:c.fontSize+' '+c.fontFamily.split(',')[0]+' '+c.fontWeight,col:c.color,bg:c.backgroundColor+'|'+c.backgroundImage.slice(0,40),bd:c.borderTopWidth+' '+c.borderTopColor,pad:c.padding,rad:c.borderRadius,tt:c.textTransform,ls:c.letterSpacing}}return o})}
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});try{
for(const w of [390,1280]){
 const looks={};
 for(const v of ['font','font-theme']){
  const {ctx,p,errs,R}=await setup(b,w);await p.goto(ORIGIN+'/t/buy-'+v+'.html');await p.waitForTimeout(300);
  const FB=await p.evaluate(()=>window.FS_BUY);const web=FB.font.lics[0];
  // "קנה אותי" opens our chooser, not the theme's old window
  await p.evaluate(()=>scrollTo(0,400));await p.click('.r-open-purchase');await p.waitForTimeout(600);
  if(await p.evaluate(()=>document.querySelector('.r-font-purchase').style.display==='flex'))bad(`${w} ${v}: the old purchase window still opens`);
  if(!(await p.evaluate(()=>!document.querySelector('#buyModal').hidden)))bad(`${w} ${v}: the chooser does not open`);
  const title=await p.textContent('#buyTitle');if(title!=='נוסטלה: בחרו את הרישיון')bad(`${w} ${v}: title "${title}"`);
  if(!(await p.evaluate(()=>document.querySelector('#buyModal').contains(document.activeElement))))bad(`${w} ${v}: focus did not move into the chooser`);
  // prices are the store's (from the product's variations), VAT included
  const shown=await p.evaluate(()=>({fam:document.querySelector('#buyModal .offer .of-price b').textContent,ws:[...document.querySelectorAll('#buyModal .chips button')].map(x=>[x.querySelector('span').textContent,x.querySelector('small').textContent]),incl:document.querySelector('#buyModal .offer small').textContent}));
  if(shown.fam!==ils(web.items[0].price))bad(`${w} ${v}: family price ${shown.fam}, store ${web.items[0].price}`);
  const ws=web.items.filter(i=>!i.fam);if(shown.ws.length!==ws.length||shown.ws.some((x,i)=>x[0]!==ws[i].n||x[1]!==ils(ws[i].price)))bad(`${w} ${v}: weight tiles do not match the store ${JSON.stringify(shown.ws)}`);
  if(!shown.incl.includes('כולל מע״מ'))bad(`${w} ${v}: family price does not say VAT is included`);
  // everything the theme's window had: licence summary (from the page), price list, sale price, demo text in the font, steps
  const live=await p.evaluate(()=>({steps:[...document.querySelectorAll('#buyModal .buy-steps li')].map(x=>x.textContent+(x.getAttribute('aria-current')?'*':'')).join('|'),list:document.querySelector('#buyModal .buy-list').textContent,del:(document.querySelector('#buyModal .offer del')||{}).textContent,save:(document.querySelector('#buyModal .buy-save')||{}).textContent,demo:document.querySelector('#buyDemo').textContent,face:getComputedStyle(document.querySelector('#buyDemo')).fontFamily,infoHidden:document.querySelector('#buyInfo').hidden,full:document.querySelector('#buyModal').classList.contains('buy-full')}));
  if(live.steps!=='בחירה*|פרטי ההזמנה|תשלום')bad(`${w} ${v}: steps ${live.steps}`);
  if(!live.list.includes('מחירון וובפונט')||!live.list.includes(ils(ws[0].price))||!live.list.includes(ils(web.items[0].price))||!live.list.includes('כולל מע״מ'))bad(`${w} ${v}: price list line ${live.list}`);
  if(live.del!==ils(web.items[0].was)||live.save!=='חיסכון '+ils(web.items[0].was-web.items[0].price))bad(`${w} ${v}: family sale not shown (${live.del} / ${live.save})`);
  if(live.demo!=='אבגדהוזחטיכלמנסעפצקרשת'||!/Georgia/.test(live.face))bad(`${w} ${v}: preview is not the page's demo text in the font (${live.demo} / ${live.face})`);
  if(!live.infoHidden)bad(`${w} ${v}: licence summary open before asked`);if(!live.full)bad(`${w} ${v}: default look is not full screen`);
  await p.click('#buyModal [data-buyinfo]');await p.waitForTimeout(100);
  const inf=await p.evaluate(()=>{const e=document.querySelector('#buyInfo');return {h:e.hidden,t:e.innerText,a:(e.querySelector('a')||{}).href,x:document.querySelector('[data-buyinfo]').getAttribute('aria-expanded')}});
  if(inf.h||!inf.t.includes('רישיון וובפונט בקצרה')||!inf.t.includes('עד 3 דומיינים')||!inf.t.includes('תוצרי אינטרנט')||inf.a!=='https://site.test/licenses/'||inf.x!=='true')bad(`${w} ${v}: licence summary ${JSON.stringify(inf)}`);
  if(w>760)await p.screenshot({path:`${S}/buy-${w}-${v}-info.png`});
  await p.click('#buyModal [data-buyinfo]');await p.waitForTimeout(80);
  // type your own text: it stays when the choice changes
  await p.click('#buyDemo');await p.keyboard.press('Control+A');await p.keyboard.type('שלום עולם');
  // hover a weight: the preview line takes that weight
  if(w>760){await p.hover('#buyModal .chips button[data-fw="700"]');await p.waitForTimeout(100);const fw=await p.evaluate(()=>document.querySelector('#buyDemo').style.fontWeight);if(fw!=='700')bad(`${w} ${v}: preview did not take the hovered weight (${fw})`)}
  // choose: total follows; family replaces singles; the cheaper-family tip
  await p.click('#buyModal .chips button[data-fw="100"]');await p.click('#buyModal .chips button[data-fw="700"]');await p.waitForTimeout(120);
  if(await p.textContent('#buyDemo')!=='שלום עולם')bad(`${w} ${v}: typed preview text was lost`);
  let tot=await p.textContent('#buyTot');if(num(tot)!==ws[0].price+ws[6].price)bad(`${w} ${v}: total after two weights is ${tot}`);
  const pressed=await p.evaluate(()=>[...document.querySelectorAll('#buyModal [aria-pressed="true"]')].length);if(pressed!==2)bad(`${w} ${v}: ${pressed} tiles pressed, expected 2`);
  const edge=await p.evaluate(()=>getComputedStyle(document.querySelector('#buyModal .chips button[aria-pressed="true"]')).borderTopColor);if(edge!=='rgb(91, 63, 255)')bad(`${w} ${v}: a chosen weight has no violet edge (${edge})`);
  for(const fw of [200,300,400,500,600,900])await p.click(`#buyModal .chips button[data-fw="${fw}"]`);await p.waitForTimeout(120);
  if(!(await p.locator('#buyModal .buy-tip').count()))bad(`${w} ${v}: no tip when single weights cost more than the family`);
  await p.click('#buyModal .buy-tip .linkbtn');await p.waitForTimeout(120);
  const st=await p.evaluate(()=>({fam:document.querySelector('#buyModal .offer').getAttribute('aria-pressed'),singles:document.querySelectorAll('#buyModal .chips [aria-pressed="true"]').length,tot:document.querySelector('#buyTot').textContent,famEdge:getComputedStyle(document.querySelector('#buyModal .offer')).boxShadow}));
  if(st.fam!=='true'||st.singles)bad(`${w} ${v}: choosing the family did not replace the weights ${JSON.stringify(st)}`);
  if(num(st.tot)!==web.items[0].price)bad(`${w} ${v}: family total ${st.tot}`);if(!/91, 63, 255/.test(st.famEdge))bad(`${w} ${v}: the chosen family card has no violet edge`);
  // a desktop weight too (tabs), then keyboard: Tab stays inside the chooser
  await p.click('#buyModal .tabs button[data-buylic="desk"]');await p.waitForTimeout(120);
  if(await p.evaluate(()=>document.querySelector('#buyModal .tabs button[aria-selected="true"]').dataset.buylic)!=='desk')bad(`${w} ${v}: desktop tab does not open`);
  await p.click('#buyModal .chips button[data-fw="400"]');await p.waitForTimeout(100);
  tot=await p.textContent('#buyTot');const deskReg=FB.font.lics[1].items.find(i=>i.w==='400');if(num(tot)!==web.items[0].price+deskReg.price)bad(`${w} ${v}: total across licences ${tot}`);
  let out=0;for(let i=0;i<40;i++){await p.keyboard.press('Tab');if(!(await p.evaluate(()=>document.querySelector('#buyModal').contains(document.activeElement))))out++}if(out)bad(`${w} ${v}: Tab left the chooser ${out} times`);
  const ov1=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(ov1>1)bad(`${w} ${v}: chooser makes the page scroll sideways ${ov1}px`);
  const inv=await p.evaluate(()=>{const r=document.querySelector('#buyModal .sheet').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1});if(!inv)bad(`${w} ${v}: chooser is off screen`);
  looks[v]=await look(p);
  if(v==='font-theme')await p.screenshot({path:`${S}/buy-${w}-choose.png`});
  // Escape closes and gives focus back to "קנה אותי"
  await p.keyboard.press('Escape');await p.waitForTimeout(450);
  if(!(await p.evaluate(()=>document.querySelector('#buyModal').hidden)))bad(`${w} ${v}: Escape does not close the chooser`);
  if(!(await p.evaluate(()=>document.activeElement&&document.activeElement.classList.contains('r-open-purchase'))))bad(`${w} ${v}: focus did not go back to "קנה אותי"`);
  // order details: lines, total = sum of lines, VAT, remove a line
  await p.click('.r-open-purchase');await p.waitForTimeout(500);
  const keep=await p.evaluate(()=>[...document.querySelectorAll('#buyModal [aria-pressed="true"]')].length);if(keep!==1)bad(`${w} ${v}: reopening lost the choice (${keep} pressed)`);
  await p.click('#buyNext');await p.waitForTimeout(700);
  if(!(await p.evaluate(()=>!document.querySelector('#buyCart').hidden&&document.querySelector('#buyModal').hidden)))bad(`${w} ${v}: "לפרטי ההזמנה" does not open the order details`);
  if(!(await p.evaluate(()=>document.querySelector('#buyCart').contains(document.activeElement))))bad(`${w} ${v}: focus did not move into the order details`);
  let c=await p.evaluate(()=>({lines:[...document.querySelectorAll('#buyCart .cart-item')].map(x=>[x.querySelector(':scope>div>b').textContent,(x.querySelector(':scope>div>span')||{}).textContent||'',x.querySelector(':scope>b.num').lastChild.textContent,(x.querySelector(':scope>b.num del')||{}).textContent||'']),sum:document.querySelector('#buySum').textContent,vat:document.querySelector('#buyCart dd.vat').textContent,dels:document.querySelectorAll('#buyCart .cart-item .ibtn[aria-label^="הסרת"]').length}));
  if(c.lines.length!==2)bad(`${w} ${v}: ${c.lines.length} lines in the order details, expected 2`);
  const lsum=c.lines.reduce((a,l)=>a+num(l[2]),0);if(num(c.sum)!==lsum||lsum!==web.items[0].price+deskReg.price)bad(`${w} ${v}: total ${c.sum} is not the sum of the lines (${lsum})`);
  if(Math.abs(num(c.vat)-(web.items[0].vat+deskReg.vat))>0.011)bad(`${w} ${v}: VAT ${c.vat}`);
  if(!c.lines[0][1].includes('משפחה מלאה')||!c.lines[1][1].includes('רישיון דסקטופ'))bad(`${w} ${v}: lines do not say weight and licence ${JSON.stringify(c.lines)}`);
  if(c.dels!==2)bad(`${w} ${v}: not every line has a remove button`);
  if(c.lines[0][3]!==ils(web.items[0].was))bad(`${w} ${v}: the family line does not show the price before the sale (${c.lines[0][3]})`);
  const ov2=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(ov2>1)bad(`${w} ${v}: order details scroll sideways ${ov2}px`);
  const cs=await p.evaluate(()=>{const r=document.querySelector('#buyCart .cart-sheet').getBoundingClientRect();return {l:r.left,r:r.right,w:r.width}});if(w<=760&&cs.w<w-1)bad(`${w} ${v}: order details not full width on a phone (${cs.w})`);if(cs.l<-1||cs.r>w+1)bad(`${w} ${v}: order details off screen`);
  if(v==='font-theme')await p.screenshot({path:`${S}/buy-${w}-cart.png`});
  await p.locator('#buyCart .cart-item').nth(1).locator('.ibtn').click({timeout:3000});await p.waitForTimeout(400);
  c=await p.evaluate(()=>({n:document.querySelectorAll('#buyCart .cart-item').length,sum:document.querySelector('#buySum').textContent}));if(c.n!==1||num(c.sum)!==web.items[0].price)bad(`${w} ${v}: remove did not recalculate ${JSON.stringify(c)}`);
  // "לסל": from the chooser straight to the order details, without changing the choice
  await p.click('[data-cartx]');await p.waitForTimeout(450);await p.click('.r-open-purchase');await p.waitForTimeout(500);
  const cb=p.locator('#buyModal [data-buycart]');if(!(await cb.count())||!(await cb.textContent()).includes('לסל · 1'))bad(`${w} ${v}: no "לסל" button with the cart count`);else{await cb.click();await p.waitForTimeout(500);if(!(await p.evaluate(()=>!document.querySelector('#buyCart').hidden&&document.querySelectorAll('#buyCart .cart-item').length===1)))bad(`${w} ${v}: "לסל" does not open the order details`)}
  if((await p.evaluate(()=>[...document.querySelectorAll('#buyCart .buy-steps li')].findIndex(x=>x.getAttribute('aria-current'))))!==1)bad(`${w} ${v}: order details are not step 2`);
  // pay: one request even on a double click, then the store's checkout
  await Promise.all([p.waitForURL('**/checkout/',{timeout:5000}).catch(()=>bad(`${w} ${v}: pay did not go to the checkout`)),p.dblclick('#buyPay')]);
  if(R.pay!==1)bad(`${w} ${v}: ${R.pay} payment requests for one double click`);
  if(errs.length)bad(`${w} ${v}: JS errors ${errs}`);
  await ctx.close();
 }
 {const {ctx,p,errs}=await setup(b,w);await p.goto(ORIGIN+'/t/buy-font-sheet.html');await p.waitForTimeout(300);await p.click('.r-open-purchase');await p.waitForTimeout(600);
  const r=await p.evaluate(()=>{const m=document.querySelector('#buyModal'),q=m.querySelector('.sheet').getBoundingClientRect();return {full:m.classList.contains('buy-full'),w:q.width,ov:document.documentElement.scrollWidth-innerWidth}});
  if(r.full)bad(`${w} sheet look: opened full screen`);if(w>760&&r.w>761)bad(`${w} sheet look: window ${r.w}px wide`);if(r.ov>1)bad(`${w} sheet look: scrolls sideways`);
  await p.screenshot({path:`${S}/buy-${w}-sheet.png`});if(errs.length)bad(`${w} sheet look: JS errors ${errs}`);await ctx.close()}
 // the hostile theme must not change our look
 for(const [s,a] of Object.entries(looks.font)){const t=looks['font-theme'][s];if(!t){bad(`${w}: ${s} missing under the theme`);continue}
  for(const k of Object.keys(a)){if(['w','h'].includes(k)&&Math.abs(a[k]-t[k])<=1)continue;if(String(a[k])!==String(t[k]))bad(`${w} theme changes ${s} ${k}: ${a[k]} → ${t[k]}`)}}
 // plans from the pricing page: straight to the order details, renewal said plainly; a plain text link is left alone
 {const {ctx,p,errs,R}=await setup(b,w);await p.goto(ORIGIN+'/t/buy-pricing.html');await p.waitForTimeout(300);const FB=await p.evaluate(()=>window.FS_BUY);
  await p.click('#pDesk');await p.waitForTimeout(600);
  if(p.url().includes('add-to-cart'))bad(`${w} pricing: desktop button left the page`);
  let c=await p.evaluate(()=>({open:!document.querySelector('#buyCart').hidden,lines:[...document.querySelectorAll('#buyCart .cart-item')].map(x=>x.innerText),img:!!document.querySelector('#buyCart .cart-ic.is-plan img'),sum:(document.querySelector('#buySum')||{}).textContent}));
  if(!c.open||c.lines.length!==1)bad(`${w} pricing: desktop plan did not open the order details ${JSON.stringify(c)}`);
  else{if(!/מתחדש כל חודש/.test(c.lines[0])||!/החיוב הבא ב־\d\d\.\d\d\.\d{4}/.test(c.lines[0]))bad(`${w} pricing: the plan does not say when it renews: ${c.lines[0]}`);if(!/24 חודשים/.test(c.lines[0]))bad(`${w} pricing: desktop commitment missing`);
   if(num(c.sum)!==FB.plans.desk.price)bad(`${w} pricing: desktop total ${c.sum}, store ${FB.plans.desk.price}`);if(!c.img)bad(`${w} pricing: plan line has no plan logo`)}
  if(w===390)await p.screenshot({path:`${S}/buy-${w}-plan.png`});
  await p.keyboard.press('Escape');await p.waitForTimeout(450);if(!(await p.evaluate(()=>document.activeElement&&document.activeElement.id==='pDesk')))bad(`${w} pricing: focus did not go back to the plan button`);
  await p.click('#pWeb');await p.waitForTimeout(600);c=await p.evaluate(()=>[...document.querySelectorAll('#buyCart .cart-item b:first-child')].map(x=>x.textContent));if(c.length!==1||!c[0].includes('וובסטופ'))bad(`${w} pricing: a second plan should replace the first ${c}`);
  await p.keyboard.press('Escape');await p.waitForTimeout(450);
  await Promise.all([p.waitForURL('**/product/**',{timeout:3000}).catch(()=>bad(`${w} pricing: a plain text link was taken over`)),p.click('#pNav')]);
  if(errs.length)bad(`${w} pricing: JS errors ${errs}`);await ctx.close()}
 // thank-you page: paid -> confetti once and a toast; reload -> not again. Failed -> plain words and a way to try again
 {const {ctx,p,errs}=await setup(b,w);await p.addInitScript(()=>{const a=HTMLCanvasElement.prototype.getContext;window.__conf=0;HTMLCanvasElement.prototype.getContext=function(...x){window.__conf++;return a.apply(this,x)}});
  await p.goto(ORIGIN+'/t/buy-paid.html');await p.waitForTimeout(900);
  let d=await p.evaluate(()=>({open:!document.querySelector('#buyCart').hidden,txt:document.querySelector('#buyCartBody').innerText,conf:window.__conf,toast:document.querySelector('#toast').textContent,href:(document.querySelector('#buyCart .cart-go')||{}).href}));
  if(!d.open||!d.txt.includes('התשלום התקבל'))bad(`${w} paid: no thank-you ${JSON.stringify(d)}`);if(d.conf!==1)bad(`${w} paid: confetti ${d.conf} times`);if(!d.toast.includes('הרכישה הושלמה'))bad(`${w} paid: no toast`);if(d.href!=='https://site.test/my-account/')bad(`${w} paid: button goes to ${d.href}`);
  if(w<=760){const ov=await p.evaluate(()=>{const t=document.querySelector('#toast').getBoundingClientRect(),g=document.querySelector('#buyCart .cart-go').getBoundingClientRect();return t.bottom>g.top&&t.top<g.bottom});if(ov)bad(`${w} paid: the toast covers the button`)}
  if(w===390)await p.screenshot({path:`${S}/buy-${w}-paid.png`});
  await p.reload();await p.waitForTimeout(700);d=await p.evaluate(()=>({open:!document.querySelector('#buyCart').hidden,conf:window.__conf}));if(d.open||d.conf)bad(`${w} paid: the celebration repeats on reload`);
  await p.goto(ORIGIN+'/t/buy-failed.html');await p.waitForTimeout(600);
  d=await p.evaluate(()=>({txt:document.querySelector('#buyCartBody').innerText,href:(document.querySelector('#buyCart .cart-go')||{}).href,conf:window.__conf}));
  if(!/לא עבר/.test(d.txt)||!/לא חויבת/.test(d.txt)||!/לנסות שוב/.test(d.txt))bad(`${w} failed: does not say what happened and what to do: ${d.txt}`);if(!/order-pay\/902/.test(d.href||''))bad(`${w} failed: try again goes to ${d.href}`);if(d.conf)bad(`${w} failed: confetti on a failed payment`);
  if(errs.length)bad(`${w} thank-you: JS errors ${errs}`);await ctx.close()}
 // inside the personal area: a customer without a plan taps "להצטרפות" -> the order details of that plan, over the area
 {const area=fs.readFileSync(S+'/page-plain.html','utf8'),pr=fs.readFileSync(S+'/buy-pricing.html','utf8');const plans=/window\.FS_BUY=(\{.*?\});\n/s.exec(pr);
  const pg=area.replace('"plan":"web"','"plan":"","buy":true').replace(/window\.FS_BUY=\{.*?\};\n/s,()=>'window.FS_BUY='+plans[1].replace(/"(planPage|font)":[^,}]*,?/g,'')+';\n');
  if(pg===area)bad(`${w} area: could not build the no-plan page`);fs.writeFileSync(S+'/buy-area.html',pg);
  const {ctx,p,errs}=await setup(b,w);await p.goto(ORIGIN+'/t/buy-area.html');await p.waitForTimeout(500);
  const cta=p.locator('#fsa .offer-extra .of-cta');if(await cta.getAttribute('data-buyplan')!=='extra')bad(`${w} area: the offer button is not linked to the purchase area`);
  await cta.click();await p.waitForTimeout(600);
  const c=await p.evaluate(()=>({open:!document.querySelector('#buyCart').hidden,addon:document.querySelector('#cart').hidden,line:(document.querySelector('#buyCart .cart-item')||{}).innerText||'',url:location.href}));
  if(!c.open||!/אקסטרה/.test(c.line)||!/מתחדש כל חודש/.test(c.line))bad(`${w} area: "להצטרפות" did not open the Extra order details ${JSON.stringify(c)}`);if(!c.addon)bad(`${w} area: the add-on cart opened too`);
  if(w===1280)await p.screenshot({path:`${S}/buy-${w}-area.png`});
  if(errs.length)bad(`${w} area: JS errors ${errs}`);await ctx.close()}
 // reduced motion: no transitions, no confetti
 {const {ctx,p}=await setup(b,w,{reducedMotion:'reduce'});await p.goto(ORIGIN+'/t/buy-font.html');await p.waitForTimeout(300);await p.click('.r-open-purchase');await p.waitForTimeout(60);
  const m=await p.evaluate(()=>[getComputedStyle(document.querySelector('#buyModal')).transitionDuration,getComputedStyle(document.querySelector('#buyModal .sheet')).transitionDuration,getComputedStyle(document.querySelector('#buyCart .cart-sheet')).transitionDuration,getComputedStyle(document.querySelector('#buyDemo')).transitionDuration]);
  if(m.some(x=>x!=='0s'))bad(`${w} reduced motion: still animates ${m}`);
  await p.goto(ORIGIN+'/t/buy-paid.html');await p.waitForTimeout(500);if(await p.evaluate(()=>!!document.querySelector('canvas')))bad(`${w} reduced motion: confetti still runs`);await ctx.close()}
}
}catch(e){bad('crashed: '+e.message.split('\n')[0])}
console.log(fails.length?'FAIL\n'+fails.join('\n'):'ALL PASSED');await b.close()})();
