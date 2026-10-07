import {writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Exercise the real page through Ego; never reclaim a finished TaskSpace.
export default async function verify({taskSpace,spaceId,reportFile='knowledge-structure-browser-acceptance-20261003.json'}) {
  if(!spaceId)throw new Error('Provide the active TaskSpace id.');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const task=await taskSpace(spaceId), page=task.page('p1'), cases=[], measurements=[];
  const sample=pathToFileURL(resolve(root,'docs/examples/forecastcompass/knowledge-structure-pilot.html')).href;
  const check=(name,pass,details)=>{cases.push({name,pass:Boolean(pass),details});console.log({check:name,pass:Boolean(pass)});};
  await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:"window.__pilotErrors=[];addEventListener('error',e=>window.__pilotErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__pilotErrors.push(String(e.reason)));" });
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const geometry=()=>page.evaluate(()=>{
    const overlap=(a,b,p=0)=>a.x<b.x+b.w+p&&a.x+a.w>b.x-p&&a.y<b.y+b.h+p&&a.y+a.h>b.y-p;
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};
    const issues=[],maps=[],figureIssues=[],figures=[];
    for(const figure of document.querySelectorAll('.concept-figure')){
      const svg=figure.querySelector('svg'),sr=rect(svg);
      const texts=[...svg.querySelectorAll('text')].map(t=>({text:t.textContent,...rect(t)}));
      for(let i=0;i<texts.length;i++){
        const t=texts[i];if(t.x<sr.x-1||t.y<sr.y-1||t.x+t.w>sr.x+sr.w+1||t.y+t.h>sr.y+sr.h+1)figureIssues.push({figure:figure.dataset.figureId,issue:'text outside SVG',text:t.text});
        for(let j=i+1;j<texts.length;j++)if(overlap(t,texts[j],-1))figureIssues.push({figure:figure.dataset.figureId,issue:'overlapping text',a:t.text,b:texts[j].text});
      }
      const parts=[...svg.querySelectorAll('[data-figure-atom]')];
      figures.push({id:figure.dataset.figureId,parts:parts.length,scrollable:figure.querySelector('.figure-scroll').scrollWidth>figure.querySelector('.figure-scroll').clientWidth,
        minFont:Math.min(...[...svg.querySelectorAll('text')].map(t=>parseFloat(getComputedStyle(t).fontSize)*(sr.w/svg.viewBox.baseVal.width))),
        accessible:svg.getAttribute('role')!=='img'&&parts.every(p=>p.getAttribute('role')==='button'&&p.getAttribute('tabindex')==='0'&&!!p.getAttribute('aria-label'))});
    }
    for(const el of document.querySelectorAll('.knowledge-map')){
      if(!el.getBoundingClientRect().width)continue;
      const cards=[...el.querySelectorAll('.atom-card')].map(e=>({id:e.dataset.nodeId,...rect(e)}));
      const labels=[...el.querySelectorAll('.graph-edge-label')].map(e=>({id:e.dataset.edgeId,...rect(e)}));
      for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++)if(overlap(cards[i],cards[j],-1))issues.push(el.dataset.mapId+': overlapping cards');
      for(let i=0;i<labels.length;i++){
        if(cards.some(c=>overlap(labels[i],c,-1)))issues.push(el.dataset.mapId+': label on card '+labels[i].id);
        for(let j=i+1;j<labels.length;j++)if(overlap(labels[i],labels[j],-1))issues.push(el.dataset.mapId+': overlapping labels');
      }
      for(const label of el.querySelectorAll('.graph-edge-label'))if(label.querySelector('text').getBBox().width>label.querySelector('rect').getBBox().width-8)issues.push(el.dataset.mapId+': clipped label');
      const svg=el.querySelector('.graph-links'),svgRect=svg.getBoundingClientRect();
      const localCards=cards.map(c=>({...c,x:c.x-svgRect.x,y:c.y-svgRect.y}));
      for(const path of el.querySelectorAll('.graph-link')){
        const length=path.getTotalLength();let hits=false;
        for(let d=2;d<length-2;d+=6){const p=path.getPointAtLength(d);if(localCards.some(c=>p.x>c.x+1&&p.x<c.x+c.w-1&&p.y>c.y+1&&p.y<c.y+c.h-1)){hits=true;break;}}
        if(hits)issues.push(el.dataset.mapId+': edge through card '+path.dataset.edgeRef);
      }
      maps.push({id:el.dataset.mapId,cards:cards.length,edges:labels.length,width:Math.round(el.clientWidth),height:Math.round(el.clientHeight)});
    }
    return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,errors:window.__pilotErrors,issues,maps,figures,figureIssues,
      minDefinitionFont:Math.min(...[...document.querySelectorAll('.atom-open p')].map(p=>parseFloat(getComputedStyle(p).fontSize))),
      modals:document.querySelectorAll('[role="dialog"]').length};
  });
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await page.goto(sample);await page.waitForFunction(()=>!!window.knowledgePilot);await settle();
  let m=await geometry();measurements.push({view:'desktop',...m});
  check('Nine real connected card diagrams render',m.maps.length===9&&m.maps.every(d=>d.cards>=4&&d.edges>=d.cards-1),m.maps);
  check('Desktop labels and paths avoid cards',!m.issues.length,m.issues);
  check('Card definitions remain readable and document fits',!m.overflow&&m.minDefinitionFont>=14,m);
  check('No popup or runtime error',m.modals===0&&!m.errors.length,m.errors);
  check('Context recaps and conceptual groups accompany all eight steps',await page.evaluate(()=>document.querySelectorAll('.context-groups').length===8&&document.querySelectorAll('.context-nudge').length===7));
  if(m.figures.length){
    check('Eight concept figures have readable, non-overlapping text',m.figures.length===8&&!m.figureIssues.length&&m.figures.every(f=>f.minFont>=13.5),{figures:m.figures,issues:m.figureIssues});
    check('Figure parts expose accessible click and keyboard controls',m.figures.every(f=>f.accessible),m.figures);
    check('Figure and part IDs remain unique in the document',await page.evaluate(()=>{const ids=[...document.querySelectorAll('.concept-figure [id]')].map(e=>e.id);return new Set(ids).size===ids.length;}));
    check('Semantic viewpoints have a centre with named side branches',await page.evaluate(()=>window.knowledgePilot.inspect().every(m=>m.topology&&m.lanes.length===3&&m.positions.some(p=>p.id===m.topology.focusId&&p.col===1))));
  }
  await page.click('a[data-nav-id="two-memories"]');
  const selector='[data-map-id="map-two-memories"]';
  if(m.figures.length){
    const factorPart=selector+' .concept-figure [data-figure-atom="factor"]';
    await page.hover(factorPart);
    check('Hovering a drawn part does not activate it',await page.evaluate(()=>document.querySelector('[data-map-id="map-two-memories"] .figure-reading').hidden));
    await page.click(factorPart);
    check('Clicking a figure part explains its definition in place and selects the card',await page.evaluate(()=>{const el=document.querySelector('[data-map-id="map-two-memories"]');return !el.querySelector('.figure-reading').hidden&&el.querySelector('.figure-reading').textContent.includes('因子记忆')&&!!el.querySelector('[data-node-id="factor"].is-focus');}));
    await page.press(selector+' .concept-figure [data-figure-atom="reasoning"]','Enter');
    check('Keyboard changes the local figure explanation to the other branch',await page.evaluate(()=>document.querySelector('[data-map-id="map-two-memories"] .figure-reading').textContent.includes('推理记忆')));
    await page.click(selector+' .figure-card-link');await settle();
    check('A drawn part can open its existing knowledge card without a modal',await page.evaluate(()=>!!document.querySelector('[data-map-id="map-two-memories"] [data-node-id="reasoning"] .atom-inline-detail')&&!document.querySelector('[role="dialog"]')));
    await page.click(selector+' [data-open-atom="reasoning"]');
    await page.click(selector+' .figure-close');
  }
  const before=await page.evaluate(()=>window.knowledgePilot.inspect().find(m=>m.id==='map-two-memories').positions);
  await page.hover(selector+' [data-open-atom="factor"]');
  check('Hover does not activate or open details',await page.evaluate(()=>!document.querySelector('.atom-inline-detail')));
  await page.click(selector+' [data-open-atom="factor"]');await settle();
  const expanded=await page.evaluate(()=>({positions:window.knowledgePilot.inspect().find(m=>m.id==='map-two-memories').positions,
    open:document.querySelector('[data-map-id="map-two-memories"] [data-node-id="factor"] .atom-inline-detail')?.textContent}));
  check('Click expands full details inside the card',expanded.open?.includes('指导搜证')&&expanded.open.includes('这里需要的前提'));
  check('Expansion keeps other columns at their reading locations',before.filter(p=>p.col!==2).every(p=>{const next=expanded.positions.find(n=>n.id===p.id);return Math.abs(next.y-p.y)<1;}),{before,after:expanded.positions});
  m=await geometry();check('Expanded card has clear labels and relationships',!m.issues.length,m.issues);
  await page.click(selector+' [data-open-atom="reasoning"]');
  check('Two cards can remain independently expanded',await page.evaluate(()=>document.querySelectorAll('[data-map-id="map-two-memories"] .atom-inline-detail').length===2));
  await page.click(selector+' [data-open-atom="reasoning"]');
  await page.click(selector+' [data-node-id="factor"] .expand-neighborhood');await settle();
  const neighborhood=await page.evaluate(()=>({nodes:window.knowledgePilot.inspect().find(m=>m.id==='map-two-memories').nodeIds,visible:!document.querySelector('[data-map-id="map-two-memories"] .map-reset').hidden}));
  check('Neighborhood extends along semantic relations',neighborhood.visible&&neighborhood.nodes.includes('signal')&&neighborhood.nodes.includes('revision'),neighborhood);
  await page.click(selector+' .map-reset');await settle();
  check('Return restores the local map and its prior disclosure',await page.evaluate(()=>window.knowledgePilot.inspect().find(m=>m.id==='map-two-memories').nodeIds.includes('taxonomy')&&!!document.querySelector('[data-map-id="map-two-memories"] [data-node-id="factor"] .atom-inline-detail')));
  await page.evaluate(()=>document.querySelector('[data-map-id="map-two-memories"] [data-node-id="factor"] .jump-to-step').scrollIntoView({block:'center',behavior:'instant'}));
  const readingPosition=await page.evaluate(()=>scrollY);
  await page.click(selector+' [data-node-id="factor"] .jump-to-step');
  check('Lecture location offers an explicit return',await page.evaluate(()=>!document.getElementById('reading-return').hidden));
  await page.click('#reading-return');await settle();
  const restored=await page.evaluate(()=>scrollY);
  check('Return restores the prior reading position',Math.abs(restored-readingPosition)<3,{readingPosition,restored});
  await page.click(selector+' [data-open-atom="factor"]');
  await page.click(selector+' .graph-edge-label[data-edge-id="e-memory-factor"]');
  check('Clickable arrow explains why its endpoints connect',await page.evaluate(()=>{const p=document.querySelector('[data-map-id="map-two-memories"] .map-detail');return !p.hidden&&p.textContent.includes('两端各自的含义');}));
  await page.press(selector+' .graph-edge-label[data-edge-id="e-memory-reasoning"]','Enter');
  check('Keyboard can inspect the relationship',await page.evaluate(()=>document.querySelector('[data-map-id="map-two-memories"] .map-detail h4').textContent.includes('推理记忆')));
  await page.click(selector+' .map-detail .map-close');
  await page.evaluate(()=>document.querySelector('[data-map-id="map-two-memories"]').scrollIntoView({block:'start',behavior:'instant'}));
  await page.screenshot({path:resolve(root,'docs/evidence/knowledge-structure-memory-20261003.png')});
  await page.goto(sample+'#research-evidence');await page.click('#research-evidence > summary');
  await page.selectOption('#setting-select','gpt-futurex');
  check('Canonical main result remains available',await page.evaluate(()=>[...document.querySelectorAll('#main-table tbody tr')].some(r=>r.textContent.includes('FoCo')&&r.textContent.includes('0.187')&&r.textContent.includes('0.195'))));
  await page.selectOption('#ablation-metric','ece');
  check('Week four contrary result remains visible',await page.evaluate(()=>{const rows=[...document.querySelectorAll('#ablation-table tbody tr')].map(r=>[...r.children].map(c=>c.textContent.trim()));return rows[1]?.[4]==='0.083'&&rows[3]?.[4]==='0.091';}));
  await page.click('#research-evidence > summary');
  for(const width of [900,390]){
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});
    await page.reload();await page.waitForFunction(()=>!!window.knowledgePilot);await settle();
    m=await geometry();measurements.push({view:'width-'+width,...m});
    check('Readable card layout without page overflow at '+width,!m.overflow&&m.minDefinitionFont>=14,m);
    check('No clipped or overlapping diagram objects at '+width,!m.issues.length&&!m.errors.length,{issues:m.issues,errors:m.errors});
    if(m.figures.length){
      check('Concept text remains readable within its pan view at '+width,!m.figureIssues.length&&m.figures.every(f=>f.minFont>=13.5),{figures:m.figures,issues:m.figureIssues});
      check('Compact layout retains named concept branches at '+width,await page.evaluate(()=>window.knowledgePilot.inspect().filter(m=>m.id!=='overview').every(m=>m.topology&&m.lanes.some(l=>l.label===m.topology.leftLabel)&&m.lanes.some(l=>l.label===m.topology.rightLabel))));
    }
    await page.click('a[data-nav-id="update"]');await settle();
    check('Navigation follows the current local problem at '+width,await page.evaluate(()=>document.querySelector('[aria-current="step"]')?.dataset.navId==='update'));
    if(width===390){
      await page.evaluate(()=>document.querySelector('[data-map-id="map-update"]').scrollIntoView({block:'start',behavior:'instant'}));
      await page.screenshot({path:resolve(root,'docs/evidence/knowledge-structure-mobile-20261003.png')});
    }
  }
  await page.cdp('Emulation.clearDeviceMetricsOverride');await page.reload();await page.waitForFunction(()=>!!window.knowledgePilot);await settle();
  await page.click('a[data-nav-id="two-memories"]');
  const report={date:'2026-10-03',spaceId,passed:cases.filter(c=>c.pass).length,total:cases.length,cases,measurements,
    limitations:['实际浏览器的布局与交互验证，不证明真人理解。','保留已核验的论文表格，未复现模型实验。','自由画布通用布局与已安装阅读器未由此升级。','三个局部图有7个节点，分组及原位回顾是其必要阅读上下文。']};
  await writeFile(resolve(root,'docs/evidence',reportFile),JSON.stringify(report,null,2));
  return{passed:report.passed,total:report.total,failures:cases.filter(c=>!c.pass),measurements};
}
