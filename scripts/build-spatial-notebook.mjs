// Compose a native note from the verified paper data. This script only reads
// the local service and writes a reviewable plan; the host MCP commits it.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { atoms, edges, steps, stepBodies, stepContexts, results, ablation, config } from '../docs/examples/forecastcompass/knowledge-structure-pilot-data.mjs';
import { figures } from './knowledge-concept-figures.mjs';
import { proposeNotebookLayout, notebookProposalIsCurrent } from '../.runtime/notebook-layout-helper.mjs';

const base=process.env.AVC_NATIVE_ENTRYPOINT;
if(!base||!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(base))throw new Error('Use the current local canvas entrypoint.');
const before=await (await fetch(base+'api/state')).json();
const id='forecastcompass-spatial-notebook';
if(before.graphs.some(g=>g.id===id))throw new Error('This native notebook already exists; revise it incrementally.');
const clone=x=>JSON.parse(JSON.stringify(x));
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const operations=[];
const native=clone(before);
const repRef=id=>({type:'representation',id});
const freeRef=id=>({type:'element',id});
const colors=['#647b69','#647b69','#b07851','#b07851','#557c88','#557c88','#83735b','#83735b'];
const labels=['概率与时间','信号与信心','经验要能复用','双记忆分工','一次新预测','结果后修订','怎样评价证据','怎样统一复现'];
const rootEntity='notebook-foco-root',rootRep='notebook-root-rep';
function entity(e){operations.push({type:'entity.put',entity:e});native.entities.push(e);}
function representation(r){operations.push({type:'representation.put',representation:r});native.representations.push(r);}
function free(f){operations.push({type:'free.put',freeElement:f});native.freeElements.push(f);}
function relation(r){operations.push({type:'relation.put',relation:r});native.relations.push(r);}
const nodeStyle=(role,branchId,side,order,accent,column=0)=>({contentView:'card',backgroundColor:'#f4f0e8',strokeColor:'transparent',strokeWidth:0,notebook:{schemaVersion:1,role,branchId,side,order,accent,column,bodyMode:'complete'}});
entity({id:rootEntity,kind:'笔记中心',title:'ForecastCompass',description:'把过去的预测经验，变成下一次可用、可修订的指导。',source:'ForecastCompass PDF；已核验知识结构与图解',metadata:{semanticContent:{schemaVersion:1,summary:'把过去的预测经验，变成下一次可用、可修订的指导。',sections:[],sources:[{label:'ForecastCompass PDF §2–4',kind:'source'}]},expression:{schemaVersion:1,takeaway:'问题按类别找到经验；F 提醒看什么，R 指导信多少。结果揭晓后修订经验，服务未来预测。',keyPoints:['左侧建立必要背景与记忆结构；右侧展开使用、修订、评价与复现。','编号给出讲解顺序，分支与箭头给出知识关系；两者不能混作执行顺序。'],evidence:[{kind:'analysis',statement:'二维笔记组织为讲解设计。',source:'本轮组织设计'}]}}});
representation({id:rootRep,entityId:rootEntity,graphId:id,x:0,y:0,width:480,height:270,pinned:false,style:nodeStyle('root','root','right',0,'#395b48')});
const branches=[],focusStops=[],readingOrder=[repRef(rootRep)],visualFigures=[];
for(let index=0;index<steps.length;index++){
  const step=steps[index],side=index<4?'left':'right',accent=colors[index],branchId=step.id;
  const stepEntity='notebook-step-'+step.id,stepRep=stepEntity+'-rep';
  entity({id:stepEntity,kind:'笔记分支',title:String(index+1).padStart(2,'0')+' · '+labels[index],description:step.takeaway,source:step.source,metadata:{semanticContent:{schemaVersion:1,summary:step.takeaway,sections:[{id:'question',title:step.question,html:'<p>'+escape(step.takeaway)+'</p>'}],sources:[{label:step.source,kind:step.sourceKind==='source_reported'?'source':'analysis'}]},expression:{schemaVersion:1,takeaway:step.takeaway,keyPoints:[],evidence:[{kind:step.sourceKind==='source_reported'?'source_reported':'analysis',statement:step.takeaway,source:step.source}]}}});
  representation({id:stepRep,entityId:stepEntity,graphId:id,x:side==='left'?-700:700,y:index*900,width:340,height:200,pinned:false,style:nodeStyle('branch',branchId,side,-1,accent)});
  const members=[];
  for(const [j,atom] of atoms.filter(atom=>atom.introducedAt===step.id).entries()){
    const canonical='pilot-ks-atom-'+atom.id;
    if(!before.entities.some(e=>e.id===canonical))throw new Error('Missing canonical concept '+canonical);
    const rep='notebook-concept-'+atom.id;
    representation({id:rep,entityId:canonical,graphId:id,x:side==='left'?-1250:1250,y:index*900+j*230,width:450,height:200,pinned:false,subgraphIds:['forecastcompass-knowledge-structure-pilot-'+step.id],style:nodeStyle('concept',branchId,side,j,accent,0)});
    members.push(repRef(rep));readingOrder.push(repRef(rep));
    relation({id:'notebook-introduces-'+atom.id,kind:'reference',from:stepEntity,to:canonical,metadata:{graphId:id,notebook:{kind:'branch',axis:'horizontal',branchId},expression:{schemaVersion:1,explanation:'在这个问题附近建立概念，供当前分支连续阅读。',transfers:atom.definition,evidence:[{kind:'analysis',statement:'概念在当前讲解分支中引入。',source:'知识结构 introducedAt'}]},style:{strokeColor:accent,strokeWidth:1.2,opacity:65}}});
  }
  const sourceImage=before.freeElements.find(f=>f.id==='pilot-ks-diagram-'+step.id);
  if(!sourceImage)throw new Error('Missing verified diagram '+step.id);
  const figure=figures.find(f=>f.stepId===step.id);
  const imageId='notebook-diagram-'+step.id, width=1000,height=Math.round(width*figure.height/figure.width);
  const image=clone(sourceImage);
  image.id=imageId;image.graphId=id;
  image.element={...image.element,id:imageId,x:side==='left'?-2400:2400,y:index*900,width,height,locked:false,index:null,groupIds:[],frameId:null,customData:{...image.element.customData,notebook:{schemaVersion:1,role:'diagram',branchId,order:0,column:1},conceptFigure:{...image.element.customData.conceptFigure,parts:figure.parts}}};
  free(image);members.push(freeRef(imageId));readingOrder.push(freeRef(imageId));
  const proseId='notebook-prose-'+step.id;
  const paragraphs=stepBodies[step.id];
  if(!Array.isArray(paragraphs)||paragraphs.some(p=>typeof p!=='string'))throw new Error('Missing verified prose '+step.id);
  // The accepted prose already restates the prerequisites at use. Keep it
  // intact instead of turning the same recap into a second repeated block.
  const html=paragraphs.map((p,j)=>'<p id="'+step.id+'-paragraph-'+j+'">'+escape(p)+'</p>').join('')
    +'<p id="'+step.id+'-bridge"><strong>接下来：</strong>'+escape(stepContexts[step.id].bridge)+'</p>';
  free({id:proseId,graphId:id,element:{id:proseId,type:'rectangle',x:side==='left'?-2400:2400,y:index*900+height+32,width:1000,height:300,angle:0,strokeColor:'transparent',backgroundColor:'#f4f0e8',fillStyle:'solid',strokeWidth:0,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,roundness:null,boundElements:null,link:null,locked:false,version:1,versionNonce:1,seed:1,isDeleted:false,updated:Date.now(),customData:{richTextBox:{schemaVersion:1,title:step.question,role:'text',html,fontSize:20,fontFamily:'Avenir Next, PingFang SC, sans-serif',color:'#35493e',fill:'#f4f0e8',border:'transparent'},notebook:{schemaVersion:1,role:'prose',branchId,order:1,column:1},source:step.source}}});
  members.push(freeRef(proseId));readingOrder.push(freeRef(proseId));
  branches.push({id:branchId,title:labels[index],side,order:index,accent,anchor:repRef(stepRep),members});
  focusStops.push({id:step.id,title:labels[index],refs:[repRef(stepRep),freeRef(imageId),freeRef(proseId),...members.filter(r=>r.type==='representation')]});
  visualFigures.push({...clone(before.graphs.find(g=>g.id==='forecastcompass-knowledge-structure-pilot-'+step.id)?.metadata?.expression?.visualContext?.figure??{}),elementId:imageId});
  relation({id:'notebook-root-'+step.id,kind:'reference',from:rootEntity,to:stepEntity,metadata:{graphId:id,notebook:{kind:'branch',axis:'horizontal',branchId},expression:{schemaVersion:1,explanation:step.takeaway,transfers:step.question,evidence:[{kind:'analysis',statement:'中心到讲解分支的组织关系。',source:'本轮二维笔记组织'}]},style:{strokeColor:accent,strokeWidth:3.5,opacity:80}}});
}
if(operations.filter(o=>o.type==='representation.put'&&o.representation.id.startsWith('notebook-concept-')).length!==atoms.length)throw new Error('Every canonical concept must have one placement.');
const notebook={schemaVersion:1,mode:'spatial-note',root:repRef(rootRep),branches,focusStops};
const graph={id,title:'ForecastCompass · 图文思维笔记',kind:'mixed',description:'同一平面完整显示文字、图解和概念分支；自由摆放与自动整理共用项目内容。',metadata:{notebook,contentWorkspace:{schemaVersion:1,defaultView:'layout',order:readingOrder},content:{readingOrder},expression:{schemaVersion:1,scenario:'paper',audience:'首次接触领域的读者和需要研究细节的科研工作者',objective:'图文穿插、二维展开，必要概念在使用处可以找回。',thesis:'双记忆把经验分成搜证指导和概率推理指导，再从结果后复盘修订未来记忆。',glossary:atoms.map(a=>({id:a.id,term:a.title,definition:a.definition,source:a.source})),routes:focusStops.map(stop=>({id:stop.id,title:stop.title,steps:stop.refs})),knowledgeGraph:{schemaVersion:1,atoms:atoms.map(a=>({id:a.id,entityId:"pilot-ks-atom-"+a.id,title:a.title,introducedAt:a.introducedAt})),edges:edges.map(e=>({id:e.id,from:e.from,to:e.to,label:e.label,semanticType:e.semanticType}))},readingContext:{schemaVersion:1,mode:"spatial-note",branchContexts:steps.map((s,i)=>({stepId:s.id,question:s.question,previousConclusion:i?steps[i-1].takeaway:null,requiredContext:stepContexts[s.id].reminders,newConceptGroups:stepContexts[s.id].newConceptGroups,bridge:stepContexts[s.id].bridge}))},visualContext:{schemaVersion:1,notebook:{root:repRef(rootRep),branches:branches.map(b=>({id:b.id,title:b.title,side:b.side,anchor:b.anchor}))},figures:visualFigures.map(({parts,...figure})=>({...figure,partCount:parts?.length??0})),omissions:["图解部件映射保存在对应自由元素 customData.conceptFigure.parts，请按 elementId 扩读。"],relationPlacementIsNotExecution:true}}}};
native.graphs.push(graph);
operations.unshift({type:'graph.put',graph});
const proposal=proposeNotebookLayout(native,id);
if(!notebookProposalIsCurrent(native,proposal))throw new Error('Native notebook layout is not applicable: '+proposal.warnings.join(';'));
// Apply geometry to the new object definitions; no intermediate unarranged
// revision is published and no original object is rewritten.
for(const operation of proposal.operations){
  if(operation.type==='representation.patch'){
    const original=operations.find(o=>o.type==='representation.put'&&o.representation.id===operation.id);
    Object.assign(original.representation,operation.patch);
  }else if(operation.type==='free.put'){
    const original=operations.find(o=>o.type==='free.put'&&o.freeElement.id===operation.freeElement.id);
    original.freeElement=operation.freeElement;
  }
}
await mkdir(new URL('../docs/evidence/',import.meta.url),{recursive:true});
const baseline={date:'2026-10-03',projectId:before.projectId,workCopyId:before.workCopyId,revision:before.revision,evaluationSha256:digest({results,ablation,config}),objects:Object.fromEntries(['entities','relations','graphs','representations','freeElements','annotations','batches','resources'].map(key=>[key,before[key].map(item=>({id:item.id,sha256:digest(item)}))]))};
await writeFile(new URL('../docs/evidence/spatial-notebook-baseline-20261003.json',import.meta.url),JSON.stringify(baseline,null,2));
await writeFile(new URL('../docs/examples/forecastcompass/spatial-notebook-operations.json',import.meta.url),JSON.stringify({projectId:before.projectId,workCopyId:before.workCopyId,baseRevision:before.revision,graphId:id,operations},null,2));
console.log({baseRevision:before.revision,graphId:id,operations:operations.length,branches:branches.length,concepts:atoms.length,diagrams:figures.length,layoutWarnings:proposal.warnings});
