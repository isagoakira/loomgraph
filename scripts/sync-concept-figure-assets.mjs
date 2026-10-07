// Local resource upload only. The protected project edit is separately
// preflighted and submitted through canvas_apply by the integration agent.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { figures } from './knowledge-concept-figures.mjs';
import { topologies } from './knowledge-structure-topology.mjs';

const base=process.env.AVC_NATIVE_ENTRYPOINT;
if(!base||!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(base))throw new Error('Provide the actual local canvas entrypoint.');
const connection=await (await fetch(base+'api/connection')).json();
const token=connection.token??connection.runtimeToken??connection.runtime?.token;
if(!token)throw new Error('Local canvas connection unavailable.');
const before=await (await fetch(base+'api/state')).json();
if(before.projectId!=='cb904f16-a9ec-4a38-831c-d84d9a08df80')throw new Error('Wrong project for the existing sample.');
const receipts=[];
for(const figure of figures){
  const svg=await readFile(new URL(`../docs/examples/forecastcompass/concept-figures/${figure.stepId}.svg`,import.meta.url));
  const sha256=createHash('sha256').update(svg).digest('hex');
  const resourceId=`pilot-concept-${figure.stepId}-${sha256.slice(0,16)}`;
  const response=await fetch(base+'api/resources',{method:'POST',headers:{'content-type':'application/json','x-canvas-token':token},body:JSON.stringify({resourceId,name:`${figure.title}.svg`,mimeType:'image/svg+xml',data:svg.toString('base64'),operationId:`concept-diagram-upload-${resourceId}`,actor:{id:'root-concept-diagrams',kind:'agent'},reason:'本地持久保存有来源与稳定部件身份的知识概念 SVG 图解。'})});
  const receipt=await response.json();
  if(!response.ok)throw new Error(`Resource upload rejected: ${receipt.error?.code??response.status}`);
  receipts.push({figureId:figure.id,stepId:figure.stepId,resourceId,sha256,bytes:svg.length,replayed:Boolean(receipt.replayed)});
}
const snapshot=await (await fetch(base+'api/state')).json();
const operations=[];
for(const graph of snapshot.graphs.filter(g=>g.id==='forecastcompass-knowledge-structure-pilot'||g.id.startsWith('forecastcompass-knowledge-structure-pilot-'))){
  const stepId=graph.id.replace('forecastcompass-knowledge-structure-pilot-','');
  const figure=figures.find(f=>f.stepId===stepId),asset=receipts.find(a=>a.stepId===stepId);
  const mapId=figure?'map-'+stepId:'overview';
  const visualContext={schemaVersion:1,topology:topologies[mapId],relationPlacementIsNotExecution:true};
  const metadata=structuredClone(graph.metadata??{});
  if(figure){
    const elementId='pilot-ks-diagram-'+stepId;
    visualContext.figure={id:figure.id,stepId,title:figure.title,diagramKind:figure.diagramKind,sourceKind:figure.sourceKind,annotation:figure.annotation,resourceId:asset.resourceId,elementId,
      parts:figure.parts.map(p=>({id:p.id,domId:figure.id+'-'+p.id,atomId:p.atomId,label:p.label,meaning:p.meaning,visualRole:p.visualRole,sourceKind:p.sourceKind,box:p.box,edgeIds:p.edgeIds}))};
    const width=1240,height=Math.round(width*figure.height/figure.width);
    operations.push({type:'free.put',freeElement:{id:elementId,graphId:graph.id,element:{id:elementId,type:'image',x:0,y:-height-120,width,height,angle:0,strokeColor:'transparent',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:1,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:null,roundness:null,seed:51301,version:1,versionNonce:51231,isDeleted:false,boundElements:null,updated:Date.now(),link:null,locked:false,fileId:asset.resourceId,status:'saved',scale:[1,1],customData:{resourceId:asset.resourceId,title:figure.title,source:figure.source,conceptFigure:{figureId:figure.id,stepId,annotation:figure.annotation,sourceKind:figure.sourceKind}}}}});
    metadata.content??={};
    metadata.content.readingOrder=[{type:'element',id:elementId},...(metadata.content.readingOrder??[]).filter(r=>r.id!==elementId)];
  }
  metadata.expression={...(metadata.expression??{}),visualContext};
  operations.push({type:'graph.patch',id:graph.id,patch:{metadata}});
}
await writeFile(new URL('../docs/examples/forecastcompass/concept-diagram-native-operations.json',import.meta.url),JSON.stringify({projectId:snapshot.projectId,workCopyId:snapshot.workCopyId,baseRevision:snapshot.revision,operations},null,2));
await writeFile(new URL('../docs/evidence/concept-diagrams-resource-upload-20261003.json',import.meta.url),JSON.stringify({date:'2026-10-03',beforeRevision:before.revision,afterUploadRevision:snapshot.revision,receipts},null,2));
console.log({beforeRevision:before.revision,afterUploadRevision:snapshot.revision,resources:receipts.length,operations:operations.length});
