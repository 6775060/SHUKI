/* browser check of the guarded site scripts: the original throws on a plain page, the guarded one does not; with the elements present they still work */
const {chromium}=require('playwright');const S=process.argv[2];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});const fails=[];
 const load=async f=>{const p=await b.newPage();const e=[];p.on('pageerror',x=>e.push(x.message));await p.goto('file://'+S+'/'+f);await p.waitForTimeout(200);return {p,e}};
 const o=await load('sitejs-orig.html');if(o.e.length<2)fails.push('the original scripts should throw on a plain page (test is not testing anything): '+o.e);
 const a=await load('sitejs-bare.html');if(a.e.length)fails.push('guarded scripts still throw: '+a.e.join(' | '));
 const f=await load('sitejs-full.html');if(f.e.length)fails.push('guarded scripts throw with the elements present: '+f.e.join(' | '));
 const g=await f.p.evaluate(()=>document.querySelector('#go_to_account .elementor-button-text').textContent);if(!/(בוקר טוב|צהריים טובים|ערב טוב) שוקי/.test(g))fails.push('greeting no longer works: '+g);
 await f.p.click('.r-feedback-btn');if(!(await f.p.evaluate(()=>document.querySelector('.r-feedback').classList.contains('open'))))fails.push('feedback button no longer works');
 console.log(fails.length?'FAIL\n'+fails.join('\n'):'ALL PASSED');await b.close()})();
