// Small obstacle-aware orthogonal router. Card rectangles come from measured DOM.
// Routing/label checks expose geometry for acceptance; they do not assess meaning.
(() => {
  const overlap = (a,b,pad=0) => a.x < b.x+b.w+pad && a.x+a.w > b.x-pad && a.y < b.y+b.h+pad && a.y+a.h > b.y-pad;
  const inside = (p,r) => p.x > r.x && p.x < r.x+r.w && p.y > r.y && p.y < r.y+r.h;
  const blocked = (a,b,rects) => rects.some(r => a.x===b.x
    ? a.x>r.x && a.x<r.x+r.w && Math.max(a.y,b.y)>r.y && Math.min(a.y,b.y)<r.y+r.h
    : a.y>r.y && a.y<r.y+r.h && Math.max(a.x,b.x)>r.x && Math.min(a.x,b.x)<r.x+r.w);
  class Heap {
    constructor(){this.values=[];}
    push(item){const a=this.values;a.push(item);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].cost<=item.cost)break;a[i]=a[p];i=p;}a[i]=item;}
    pop(){const a=this.values,first=a[0],last=a.pop();if(a.length){let i=0;while(2*i+1<a.length){let c=2*i+1;if(c+1<a.length&&a[c+1].cost<a[c].cost)c++;if(a[c].cost>=last.cost)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
  }
  function route(positions,relations,width,height) {
    const padding=9, byId=new Map(positions), rects=positions.map(([,p])=>({x:p.x-padding,y:p.y-padding,w:p.w+2*padding,h:p.h+2*padding}));
    const ports = p => [
      {x:p.x-padding,y:p.y+p.h/2,anchor:{x:p.x,y:p.y+p.h/2},side:'left'},
      {x:p.x+p.w+padding,y:p.y+p.h/2,anchor:{x:p.x+p.w,y:p.y+p.h/2},side:'right'},
      {x:p.x+p.w/2,y:p.y-padding,anchor:{x:p.x+p.w/2,y:p.y},side:'top'},
      {x:p.x+p.w/2,y:p.y+p.h+padding,anchor:{x:p.x+p.w/2,y:p.y+p.h},side:'bottom'},
    ];
    const cardPorts=new Map(positions.map(([id,p])=>[id,ports(p)]));
    const allPorts=[...cardPorts.values()].flat();
    const sorted = v => [...new Set(v.map(n=>Math.round(n*100)/100))].sort((a,b)=>a-b);
    const xs=sorted([12,width-12,...allPorts.map(p=>p.x),...rects.flatMap(r=>[r.x-12,r.x+r.w+12])].filter(x=>x>=4&&x<=width-4));
    const ys=sorted([12,height-12,...allPorts.map(p=>p.y),...rects.flatMap(r=>[r.y-12,r.y+r.h+12])].filter(y=>y>=4&&y<=height-4));
    const nodes=[], index=new Map();
    for(const y of ys)for(const x of xs){const p={x,y};if(!rects.some(r=>inside(p,r))){index.set(x+','+y,nodes.length);nodes.push({...p,next:[]});}}
    const key = p => Math.round(p.x*100)/100+','+Math.round(p.y*100)/100;
    for(let i=0;i<nodes.length;i++){
      const a=nodes[i];const xi=xs.indexOf(a.x),yi=ys.indexOf(a.y);
      for(const [x,y]of [[xs[xi+1],a.y],[a.x,ys[yi+1]]]){
        if(x===undefined||y===undefined)continue;const j=index.get(x+','+y);if(j===undefined)continue;
        const b=nodes[j];if(blocked(a,b,rects))continue;
        const weight=Math.abs(a.x-b.x)+Math.abs(a.y-b.y),direction=a.x===b.x?1:2;
        a.next.push({j,weight,direction});b.next.push({j:i,weight,direction});
      }
    }
    const used=new Map(), labelRects=[], canvas=document.createElement('canvas'), context=canvas.getContext('2d');
    context.font='11px "PingFang SC",sans-serif';
    const output=[];
    for(const edge of relations){
      const source=cardPorts.get(edge.from),target=cardPorts.get(edge.to);
      const heap=new Heap(),dist=new Map(),prev=new Map(),starts=new Map(),goals=new Map();
      for(const port of target){const i=index.get(key(port));if(i!==undefined)goals.set(i,port);}
      for(const port of source){const i=index.get(key(port));if(i===undefined)continue;const s=i*3;dist.set(s,0);starts.set(s,port);heap.push({state:s,cost:0});}
      let found;
      while(heap.values.length){
        const item=heap.pop();if(item.cost!==dist.get(item.state))continue;
        const i=Math.floor(item.state/3),direction=item.state%3;
        if(goals.has(i)){found=item.state;break;}
        for(const next of nodes[i].next){
          const nextState=next.j*3+next.direction,segment=[i,next.j].sort((a,b)=>a-b).join(':');
          const cost=item.cost+next.weight+(direction&&direction!==next.direction?18:0)+(used.get(segment)||0)*20;
          if(cost<(dist.get(nextState)??Infinity)){dist.set(nextState,cost);prev.set(nextState,item.state);heap.push({state:nextState,cost});}
        }
      }
      if(found===undefined)throw new Error('No obstacle-free route: '+edge.id);
      const chain=[];let cursor=found;while(cursor!==undefined){chain.unshift(cursor);cursor=prev.get(cursor);}
      for(let i=1;i<chain.length;i++){const segment=[Math.floor(chain[i-1]/3),Math.floor(chain[i]/3)].sort((a,b)=>a-b).join(':');used.set(segment,(used.get(segment)||0)+1);}
      const sourcePort=starts.get(chain[0]),targetPort=goals.get(Math.floor(found/3));
      const raw=[sourcePort.anchor,...chain.map(s=>({x:nodes[Math.floor(s/3)].x,y:nodes[Math.floor(s/3)].y})),targetPort.anchor];
      const points=raw.filter((p,i)=>i===0||i===raw.length-1||!((raw[i-1].x===p.x&&p.x===raw[i+1].x)||(raw[i-1].y===p.y&&p.y===raw[i+1].y)));
      const labelWidth=Math.ceil(context.measureText(edge.label).width)+18,labelHeight=24,candidates=[];
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},length=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
        for(const t of [.5,.25,.75]){
          const anchor={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
          const offsets=a.y===b.y?[[0,0],[0,-22],[0,22]]:[[0,0],[-labelWidth/2-12,0],[labelWidth/2+12,0]];
          for(const [dx,dy]of offsets)candidates.push({x:anchor.x+dx-labelWidth/2,y:anchor.y+dy-12,w:labelWidth,h:labelHeight,anchor,score:Math.abs(dx)+Math.abs(dy)+(1-t)*2+(length<labelWidth?30:0)-Math.min(length,400)/30});
        }
      }
      const free = c => c.x>=3&&c.y>=3&&c.x+c.w<=width-3&&c.y+c.h<=height-3&&!positions.some(([,p])=>overlap(c,p,4))&&!labelRects.some(r=>overlap(c,r,5));
      let label=candidates.filter(free).sort((a,b)=>a.score-b.score)[0];
      if(!label){
        const anchor=points[Math.floor(points.length/2)];
        for(let y=10;y<height-labelHeight;y+=30)for(let x=4;x<width-labelWidth;x+=30){const c={x,y,w:labelWidth,h:labelHeight,anchor};if(free(c)){c.score=Math.abs(x+labelWidth/2-anchor.x)+Math.abs(y+12-anchor.y);candidates.push(c);}}
        label=candidates.filter(free).sort((a,b)=>a.score-b.score)[0];
      }
      if(!label)throw new Error('No clear relation label: '+edge.id);
      labelRects.push(label);
      const center={x:label.x+label.w/2,y:label.y+12};
      output.push({id:edge.id,points,label,center,targetSide:targetPort.side,sourceSide:sourcePort.side,leader:Math.abs(center.x-label.anchor.x)+Math.abs(center.y-label.anchor.y)>14});
    }
    return output;
  }
  window.knowledgeRouting={route,overlap,blocked};
})();
