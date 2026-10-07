import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Real browser acceptance. Call from ego-browser nodejs with its taskSpace helper.
export default async function verify({taskSpace}) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
  const evidence=resolve(root,"docs/evidence");
  const task=await taskSpace(2); const page=task.page("p1");
  const cases=[]; const measurements=[];
  const check=(name,pass,details)=>cases.push({name,pass:Boolean(pass),...(details===undefined?{}:{details})});
  const metrics=()=>page.evaluate(()=>({
    width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
    steps:[...document.querySelectorAll(".step")].map(e=>({id:e.dataset.stepId,width:Math.round(e.getBoundingClientRect().width),height:Math.round(e.getBoundingClientRect().height),top:Math.round(e.getBoundingClientRect().top+scrollY)})),
    opened:[...document.querySelectorAll(".research-branch[open]")].map(e=>e.id),
    nestedScroll:[...document.querySelectorAll(".step,.core")].filter(e=>["auto","scroll"].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight).length,
    modalCount:document.querySelectorAll('[role="dialog"]').length,
  }));
  await page.cdp("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll(".step").length===8);
  let m=await metrics(); measurements.push({view:"desktop-collapsed",...m});
  check("Eight ordered understanding steps",m.steps.length===8&&m.steps.every((s,i)=>i===0||s.top>m.steps[i-1].top));
  check("Research details default to collapsed",m.opened.length===0);
  check("No document horizontal overflow at 1440",!m.overflow);
  check("Mainline uses one reading scroll",m.nestedScroll===0);
  check("Content height varies with expression role",new Set(m.steps.map(s=>s.height)).size>=4,m.steps);
  check("No modal reading surface",m.modalCount===0);
  const core=await page.evaluate(()=>({definition:document.querySelector('#step-memory-problem .core').textContent,symbols:document.querySelector('#step-two-memories .core').textContent,update:document.querySelector('#step-update .core').textContent,baselines:document.querySelector('#step-evidence .core').textContent}));
  check("Method name receives an explanation",core.definition.includes("这套方法叫 ForecastCompass，简称 FoCo"));
  check("Nonessential s/M notation deferred",!core.symbols.includes("M=(F,R)")&&!core.symbols.includes("子类别 s"));
  check("Both F and R update objects visible",core.update.includes("F 局部修订")&&core.update.includes("R 修订"));
  check("BASE and Static defined before the table",core.baselines.includes("BASE 不使用外部记忆")&&core.baselines.includes("不随每周结果更新"));
  await page.click("a[data-nav-id='two-memories']");
  const before=await page.evaluate(()=>({summaryTop:document.querySelector('#research-two-memories > summary').getBoundingClientRect().top+scrollY,nextTop:document.querySelector('#step-inference').getBoundingClientRect().top+scrollY}));
  await page.click("#research-two-memories > summary");
  const after=await page.evaluate(()=>({summaryTop:document.querySelector('#research-two-memories > summary').getBoundingClientRect().top+scrollY,nextTop:document.querySelector('#step-inference').getBoundingClientRect().top+scrollY,open:document.querySelector('#research-two-memories').open}));
  check("Research opens in place",after.open&&Math.abs(before.summaryTop-after.summaryTop)<2);
  check("Disclosure pushes later steps down",after.nextTop>before.nextTop+100,{before:before.nextTop,after:after.nextTop});
  await page.click("#research-two-memories > summary");
  const collapsed=await page.evaluate(()=>document.querySelector('#step-inference').getBoundingClientRect().top+scrollY);
  check("Collapse restores following position",Math.abs(collapsed-before.nextTop)<2);
  await page.click("#research-two-memories > summary");
  await page.click("a[data-nav-id='evidence']");
  await page.click("#research-evidence > summary");
  const opened=await metrics();
  check("Independent branches can remain open",opened.opened.includes("research-two-memories")&&opened.opened.includes("research-evidence"));
  const expected={"gpt-prophet":["0.075","0.077"],"gpt-futurex":["0.187","0.195"],"gemini-prophet":["0.118","0.090"],"gemini-futurex":["0.216","0.198"]};
  for(const [setting,values] of Object.entries(expected)){
    await page.selectOption("#setting-select",setting);
    const rows=await page.evaluate(()=>[...document.querySelectorAll('#main-table tbody tr')].map(r=>[...r.children].map(c=>c.textContent.trim())));
    const full=rows.find(r=>r[0]==="FoCo");
    check(`Table 1 ${setting} renders matched values`,rows.length===8&&full?.[1]===values[0]&&full?.[2]===values[1],full);
    check(`Retro remains diagnostic in ${setting}`,rows[0]?.[3]==="揭晓后诊断");
  }
  await page.selectOption("#ablation-metric","ece");
  let rows=await page.evaluate(()=>[...document.querySelectorAll('#ablation-table tbody tr')].map(r=>[...r.children].map(c=>c.textContent.trim())));
  check("Week 4 ECE reversal remains visible",rows[1]?.[4]==="0.083"&&rows[3]?.[4]==="0.091",rows.map(r=>[r[0],r[4],r[5]]));
  check("Average ECE distinction remains visible",rows[1]?.[5]==="0.209"&&rows[3]?.[5]==="0.195");
  await page.selectOption("#ablation-metric","brier");
  rows=await page.evaluate(()=>[...document.querySelectorAll('#ablation-table tbody tr')].map(r=>[...r.children].map(c=>c.textContent.trim())));
  check("Brier switch retains aligned week columns",rows[3]?.slice(1).join(",")==="0.221,0.202,0.180,0.144,0.187");
  await page.click("a[data-nav-id='reproduction']");
  await page.click("#research-reproduction > summary");
  const config=await page.evaluate(()=>({headers:[...document.querySelectorAll('#research-reproduction th[scope="col"]')].map(e=>e.textContent),text:document.querySelector('#research-reproduction').textContent,records:JSON.parse(document.querySelector('#canonical-data').textContent).config}));
  check("Configuration distinguishes source and interpretation",config.headers.includes("复现说明（分析）")&&config.records.some(r=>r.noteKind==="analysis"));
  check("Missing reproduction parameters remain explicit",config.text.includes("未核实")&&config.text.includes("SDK 版本"));
  await page.click("a[data-nav-id='update']");
  await page.click("#research-update > summary");
  await page.click("#research-update .source-figure > summary");
  await page.waitForFunction(()=>document.querySelector('.source-figure img').naturalWidth>0);
  check("Original paper image loads within the branch",await page.evaluate(()=>document.querySelector('.source-figure img').naturalWidth>0));
  await page.click("#research-update .source-figure > summary");
  for(const q of ["division","time","ablation"])await page.click(`input[name='${q}'][value='0']`);
  await page.click("#quiz button[type='submit']");
  check("Comprehension controls give explanations",await page.evaluate(()=>document.querySelector('#quiz-result').textContent.includes("3 / 3")));
  await page.click("#quiz button[type='reset']");
  check("User receives unanswered comprehension questions",await page.evaluate(()=>document.querySelector('#quiz-result').textContent===""&&document.querySelectorAll('#quiz input:checked').length===0));
  await page.click("#overview-toggle");
  check("Overview uses the same eight content targets",await page.evaluate(()=>!document.querySelector('#structure-overview').hidden&&document.querySelectorAll('#structure-overview a').length===8));
  await page.click("#overview-toggle");
  for(const [width,height] of [[900,900],[390,844]]){
    await page.cdp("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<700});
    await page.reload();
    await page.waitForFunction(()=>document.querySelectorAll('.step').length===8);
    m=await metrics(); measurements.push({view:`width-${width}`, ...m});
    check(`Mainline remains readable at ${width}`,m.steps.length===8&&!m.overflow&&m.nestedScroll===0,m);
    await page.click("a[data-nav-id='evidence']");await page.click("#research-evidence > summary");
    await page.selectOption("#ablation-metric","ece");
    const narrow=await metrics();
    check(`Dense evidence stays within document at ${width}`,!narrow.overflow&&narrow.opened.includes("research-evidence"));
    if(width===390) await page.screenshot({path:resolve(evidence,"reading-flow-mobile-20261003.png")});
  }
  await page.cdp("Emulation.clearDeviceMetricsOverride");
  await page.reload();
  await page.click("a[data-nav-id='two-memories']");
  await page.screenshot({path:resolve(evidence,"reading-flow-memory-20261003.png")});
  await page.click("a[data-nav-id='evidence']");await page.click("#research-evidence > summary");await page.selectOption("#ablation-metric","ece");
  await page.click("#ablation-metric");
  await page.press("#ablation-metric","Escape");
  await page.screenshot({path:resolve(evidence,"reading-flow-evidence-20261003.png")});
  const report={date:"2026-10-03",kind:"real-browser-pilot-acceptance",cases,measurements,passed:cases.filter(c=>c.pass).length,total:cases.length,limitations:["浏览器断言验证呈现与操作，不证明真人理解。","Node 与界面没有复现论文模型实验。","自适应尺寸在派生阅读预览中验证；自由画布的通用尺寸/布局机制尚未实现。","这是样例，不是已安装阅读器的正式升级。"]};
  await writeFile(resolve(evidence,"reading-flow-browser-acceptance-20261003.json"),JSON.stringify(report,null,2));
  await page.reload();await page.click("a[data-nav-id='probability']");
  return {passed:report.passed,total:report.total,failures:cases.filter(c=>!c.pass),measurements,spaceId:task.spaceId};
}
