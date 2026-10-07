(() => {
  const knowledge = JSON.parse(document.getElementById('knowledge-data').textContent);
  const atoms = new Map(knowledge.atoms.map(a => [a.id, a]));
  const edges = new Map(knowledge.edges.map(e => [e.id, e]));
  const maps = new Map(knowledge.maps.map(m => [m.id, m]));
  const topologies = knowledge.topologies ?? {};
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kind = a => ({source_reported:'原文',example:'讲解案例',analysis:'解释'}[a.sourceKind] || '解释');
  const states = new Map();
  let resizeFrame = 0;
  let readingReturn = null;
  const neighbors = id => knowledge.edges.filter(e => e.from === id || e.to === id);
  const widget = id => [...document.querySelectorAll('.knowledge-map')].find(e => e.dataset.mapId === id);
  const roundedPath = points => {
    if(points.length<3)return points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ');
    let path=`M${points[0].x} ${points[0].y}`;
    for(let i=1;i<points.length-1;i++){
      const before=points[i-1],p=points[i],after=points[i+1];
      const inLength=Math.hypot(p.x-before.x,p.y-before.y),outLength=Math.hypot(after.x-p.x,after.y-p.y);
      const r=Math.min(7,inLength/3,outLength/3);
      const a={x:p.x-(p.x-before.x)*r/inLength,y:p.y-(p.y-before.y)*r/inLength};
      const b={x:p.x+(after.x-p.x)*r/outLength,y:p.y+(after.y-p.y)*r/outLength};
      path+=` L${a.x} ${a.y} Q${p.x} ${p.y} ${b.x} ${b.y}`;
    }
    const end=points.at(-1);return path+` L${end.x} ${end.y}`;
  };

  function layout(id) {
    const state = states.get(id); const element = widget(id); if (!state || !element) return;
    const map = state.map; const viewport = element.querySelector('.graph-viewport'); if (!viewport.clientWidth) return; const width = Math.max(230, viewport.clientWidth);
    const narrow = width < 800;
    const topology = map.topology ?? topologies[map.id];
    const columns = topology ? [topology.left, [topology.focusId], topology.right] : map.columns;
    const cardWidth = Math.floor(narrow ? width - 92 : Math.max(180, Math.min(275, (width - 44 - (columns.length - 1) * 92) / columns.length)));
    const cards = element.querySelector('.graph-cards');
    if (!cards.children.length || state.renderedMap !== map) {
      const introduced = knowledge.stepContexts[map.stepId]?.introducedConceptIds ?? [];
      cards.innerHTML = map.nodeIds.map(nodeId => { const a = atoms.get(nodeId); return `<article class="atom-card ${introduced.includes(nodeId)?'is-new':''} ${nodeId===topology?.focusId?'is-center':''}" data-node-id="${escape(nodeId)}"><button type="button" class="atom-open" data-open-atom="${escape(nodeId)}" aria-expanded="false" aria-label="${escape(a.title)}：${escape(a.definition)}"><strong>${escape(a.title)}</strong><p>${escape(a.definition)}</p><small><span>${kind(a)}</span>${introduced.includes(nodeId)?'<span class="new-tag">本步引入</span>':'<span>理解与关联 ＋</span>'}</small></button></article>`; }).join('');
      state.renderedMap = map;
    }
    const positions = new Map();
    for (const card of cards.children) card.style.width = cardWidth + 'px';
    const gap = narrow ? 96 : 76;
    const cardById = new Map([...cards.children].map(c=>[c.dataset.nodeId,c]));
    const baseHeight = nodeId => cardById.get(nodeId).querySelector('.atom-open').offsetHeight+2;
    const baseColumnHeights = columns.map(column => column.reduce((sum,nodeId)=>sum+baseHeight(nodeId),0)+gap*Math.max(0,column.length-1));
    const baseMax = Math.max(...baseColumnHeights);
    const lanes = [];
    let bottom = 0;
    const place = (nodeId,col,x,y,w=cardWidth) => {
      const card=cardById.get(nodeId);card.style.width=w+'px';card.style.left=x+'px';card.style.top=y+'px';
      const h=card.offsetHeight;positions.set(nodeId,{x,y,w,h,col});bottom=Math.max(bottom,y+h);return h;
    };
    const labels=topology?[topology.leftLabel,topology.centerLabel,topology.rightLabel]:columns.map((_,i)=>'关联分支 '+(i+1));
    if(narrow){
      let y=38;
      const ordered = topology ? [1,0,2] : columns.map((_,i)=>i);
      for(const col of ordered){
        if(!columns[col].length)continue;
        lanes.push({col,label:labels[col],x:22,y:y-24,w:width-46});
        for(const nodeId of columns[col]){const w=nodeId===topology?.focusId?width-50:cardWidth;const x=nodeId===topology?.focusId?22:48;y+=place(nodeId,col,x,y,w)+gap;}
        y+=12;
      }
    }else{
      const laneSpan=cardWidth+92;
      const startX=(width-(columns.length*cardWidth+(columns.length-1)*92))/2;
      columns.forEach((column,col)=>{
        let y=44;
        // Anchor the centre to the closed-card geometry. Opening a side card
        // only moves subsequent cards in that branch, never another branch.
        if(topology&&col===1)y+=Math.max(0,(baseMax-baseColumnHeights[col])/2);
        lanes.push({col,label:labels[col],x:startX+col*laneSpan,y:18,w:cardWidth});
        for(const nodeId of column)y+=place(nodeId,col,startX+col*laneSpan,y)+gap;
      });
    }
    const height = bottom + 58;
    state.topology=topology;state.lanes=lanes;
    state.positions = positions; state.width = width; state.height = height;
    const scene = element.querySelector('.graph-scene'); scene.style.width = width + 'px'; scene.style.height = height + 'px';
    const slot = element.querySelector('.graph-slot'); slot.style.width = width + 'px'; slot.style.height = height + 'px';
    const svg = element.querySelector('.graph-links'); svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const marker = 'arrow-' + id.replace(/[^a-zA-Z0-9-]/g,'-');
    const mapEdges = map.edgeIds.map(edgeId => edges.get(edgeId));
    state.routes = window.knowledgeRouting.route([...positions], mapEdges, width, height);
    svg.innerHTML = `<defs><marker id="${marker}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8Z" fill="#67846e"/></marker></defs>` + lanes.map(lane=>`<g class="graph-branch-heading" data-branch-col="${lane.col}"><text x="${lane.x+2}" y="${lane.y}" dominant-baseline="central">${escape(lane.label)}</text><path d="M${lane.x} ${lane.y+14} H${lane.x+lane.w}"/></g>`).join('') + state.routes.map(route => {
      const edge = edges.get(route.id);
      const path = roundedPath(route.points);
      const color = ['contains','index'].includes(edge.semanticType) ? 'structure' : ['evidence','evaluate','compare'].includes(edge.semanticType) ? 'evidence' : 'action';
      return `<path class="graph-link kind-${color}" data-edge-ref="${escape(edge.id)}" d="${path}" marker-end="url(#${marker})"/><path class="graph-edge-hit" data-edge-id="${escape(edge.id)}" d="${path}"/>${route.leader ? `<path class="graph-label-leader" d="M${route.label.anchor.x} ${route.label.anchor.y} L${route.center.x} ${route.center.y}"/>` : ''}<g class="graph-edge-label kind-${color}" role="button" tabindex="0" data-edge-id="${escape(edge.id)}" aria-label="${escape(edge.explanation)}" transform="translate(${route.center.x},${route.center.y})"><rect x="${-route.label.w/2}" y="-12" width="${route.label.w}" height="24"/><text text-anchor="middle" dominant-baseline="central">${escape(edge.label)}</text></g>`;
    }).join('');
    highlight(id, state.focus);
  }

  function highlight(id, focus) {
    const el = widget(id); const related = focus?.type === 'node' ? neighbors(focus.id) : focus?.type === 'edge' ? [edges.get(focus.id)] : [];
    const nodeIds = new Set(related.flatMap(e => [e.from,e.to]));
    for (const card of el.querySelectorAll('.atom-card')) { card.classList.toggle('is-focus',focus?.type === 'node' && card.dataset.nodeId === focus.id);card.classList.toggle('is-neighbor',nodeIds.has(card.dataset.nodeId) && card.dataset.nodeId !== focus?.id); }
    for (const path of el.querySelectorAll('.graph-link')) path.classList.toggle('is-focus',related.some(e => e.id === path.dataset.edgeRef));
    for(const part of el.querySelectorAll('[data-figure-atom]')){const selected=focus?.type==='node'&&part.dataset.figureAtom===focus.id;part.classList.toggle('is-selected',selected);part.setAttribute('aria-pressed',String(selected));}
  }
  function detail(id, title, body, focus, host) {
    const el = widget(id); const state = states.get(id); state.focus = focus;
    let box; if(host) { box=host.querySelector('.atom-inline-detail'); if(!box) { box=document.createElement('div'); box.className='atom-inline-detail'; host.append(box); } host.querySelector('.atom-open').setAttribute('aria-expanded','true'); } else { box=el.querySelector('.map-detail'); box.hidden = false; }
    box.innerHTML = `<div class="map-detail-header"><h4>${escape(title)}</h4><button type="button" class="map-close" aria-label="收起当前解释">×</button></div>${body}`;
    if(host)layout(id);
    highlight(id, focus);
  }
  function showAtom(id, nodeId) {
    const a = atoms.get(nodeId); if (!a) return;
    const related = neighbors(nodeId);
    const prerequisite = (a.prerequisites??[]).map(p => `<p><b>${escape(atoms.get(p).title)}</b>：${escape(atoms.get(p).definition)}</p>`).join('');
    const items = related.map(e => { const other=e.from===nodeId?e.to:e.from;return `<button type="button" class="neighbor-button" data-neighbor-id="${escape(other)}">${escape(atoms.get(e.from).title)} <b>${escape(e.label)}</b> ${escape(atoms.get(e.to).title)}</button>`; }).join('');
    const canJump = document.getElementById('step-' + a.introducedAt);
    const actions=`<div class="node-actions">${related.length?`<button type="button" class="expand-neighborhood" data-expand-atom="${escape(nodeId)}">看关联结构</button>`:''}${canJump?`<button type="button" class="jump-to-step" data-step-jump="${escape(a.introducedAt)}">定位到主干讲解</button>`:''}</div>`;
    const body=actions+`<p>${escape(a.definition)}</p>${prerequisite?'<h5>这里需要的前提</h5>'+prerequisite:''}${(a.details??[]).map(d=>`<h5>${escape(d.title)}</h5><p>${escape(d.text)}</p>`).join('')}${a.example?`<h5>讲解例子</h5><p>${escape(a.example)}</p>`:''}${items?'<h5>沿关系延伸</h5>'+items:''}<p class="source">${kind(a)} · ${escape(a.source)}</p>`;
    const el=widget(id);const host=[...el.querySelectorAll('.atom-card')].find(c=>c.dataset.nodeId===nodeId);
    detail(id,a.title,body,{type:'node',id:nodeId},host);
  }
  function showEdge(id, edgeId) {
    const edge=edges.get(edgeId);if(!edge)return;
    const from=atoms.get(edge.from),to=atoms.get(edge.to);
    detail(id,`${from.title} ${edge.label} ${to.title}`,`<p>${escape(edge.explanation)}</p><h5>两端各自的含义</h5><p><b>${escape(from.title)}</b>：${escape(from.definition)}</p><p><b>${escape(to.title)}</b>：${escape(to.definition)}</p><p class="source">${kind(edge)} · ${escape(edge.source)}</p>`,{type:'edge',id:edgeId});
  }
  function expand(id,nodeId) {
    const state=states.get(id); const related=neighbors(nodeId); const choices=[...new Set(related.map(e=>e.from===nodeId?e.to:e.from))];
    if (!state.saved) state.saved={map:state.map,scrollY:window.scrollY,openAtomIds:[...widget(id).querySelectorAll('.atom-inline-detail')].map(box=>box.closest('.atom-card').dataset.nodeId),focus:state.focus};
    const visible=choices.slice(0,6); const selected=[nodeId,...visible];
    const incoming=visible.filter(other=>related.some(e=>e.from===other&&e.to===nodeId));
    const outgoing=visible.filter(other=>!incoming.includes(other));
    state.map={...state.map,nodeIds:selected,edgeIds:related.filter(e=>selected.includes(e.from)&&selected.includes(e.to)).map(e=>e.id),columns:[incoming,[nodeId],outgoing],topology:{focusId:nodeId,left:incoming,right:outgoing,leftLabel:'本概念的来源与前提',centerLabel:'当前探索中心',rightLabel:'用途与其他关联'}};
    const el=widget(id);el.querySelector('.map-reset').hidden=false;el.querySelector('.map-claim').textContent=`${atoms.get(nodeId).title}的关联结构。${choices.length>6?'其余关联保留在下方“沿关系延伸”中，可逐项继续查看。':''}`;
    layout(id);showAtom(id,nodeId);
  }
  function showFigurePart(part){
    const figure=part.closest('.concept-figure'), el=part.closest('.knowledge-map');if(!figure||!el)return;
    const nodeId=part.dataset.figureAtom,a=atoms.get(nodeId);if(!a)return;
    const spec=(knowledge.figures??[]).find(f=>f.id===figure.dataset.figureId);
    const partInfo=spec?.parts.find(p=>p.id===part.dataset.figurePart);
    const state=states.get(el.dataset.mapId);state.focus={type:'node',id:nodeId};
    const box=figure.querySelector('.figure-reading');
    if(box.dataset.partId===part.dataset.figurePart&&!box.hidden){box.hidden=true;state.focus=null;highlight(el.dataset.mapId,null);return;}
    box.hidden=false;box.dataset.partId=part.dataset.figurePart;
    box.innerHTML=`<div class="figure-reading-heading"><strong>${escape(a.title)}</strong><button type="button" class="figure-close" aria-label="收起图中概念说明">×</button></div><p>${escape(a.definition)}</p>${partInfo?.meaning?`<p class="figure-role"><b>图中作用：</b>${escape(partInfo.meaning)}</p>`:''}<button type="button" class="figure-card-link" data-figure-focus="${escape(nodeId)}">展开这张知识卡片</button>`;
    highlight(el.dataset.mapId,state.focus);
  }
  for(const map of knowledge.maps)states.set(map.id,{map,focus:null});
  document.addEventListener('click',event=>{
    const target=event.target.closest('button,[data-edge-id],[data-figure-atom]');if(!target)return;
    const el=target.closest('.knowledge-map');const id=el?.dataset.mapId??target.dataset.mapRef;
    if(target.dataset.recallAtom){showAtom(id,target.dataset.recallAtom);return;}
    if(!el)return;
    if(target.dataset.figureAtom){showFigurePart(target);return;}
    if(target.classList.contains('figure-close')){target.closest('.figure-reading').hidden=true;states.get(id).focus=null;highlight(id,null);return;}
    if(target.dataset.figureFocus){if(states.get(id).map.nodeIds.includes(target.dataset.figureFocus))showAtom(id,target.dataset.figureFocus);else expand(id,target.dataset.figureFocus);el.querySelector(`[data-node-id="${CSS.escape(target.dataset.figureFocus)}"]`)?.scrollIntoView({block:'center',behavior:'instant'});return;}
    if(target.dataset.openAtom){const card=target.closest('.atom-card');const open=card.querySelector('.atom-inline-detail');if(open){open.remove();target.setAttribute('aria-expanded','false');states.get(id).focus=null;layout(id);}else showAtom(id,target.dataset.openAtom);return;}
    if(target.dataset.edgeId){showEdge(id,target.dataset.edgeId);return;}
    if(target.dataset.neighborId){showAtom(id,target.dataset.neighborId);return;}
    if(target.dataset.expandAtom){expand(id,target.dataset.expandAtom);return;}
    if(target.dataset.stepJump){const state=states.get(id);readingReturn={scrollY:window.scrollY,mapId:id,atomId:state.focus?.id};document.getElementById('reading-return').hidden=false;document.getElementById('step-'+target.dataset.stepJump).scrollIntoView({block:'start',behavior:'instant'});return;}
    if(target.classList.contains('map-close')){const inline=target.closest('.atom-inline-detail');if(inline){inline.closest('.atom-card').querySelector('.atom-open').setAttribute('aria-expanded','false');inline.remove();layout(id);}else el.querySelector('.map-detail').hidden=true;states.get(id).focus=null;highlight(id,null);return;}
    if(target.classList.contains('map-reset')){
      const state=states.get(id);const saved=state.saved;if(!saved)return;state.map=saved.map;state.saved=null;el.querySelector('.map-reset').hidden=true;el.querySelector('.map-claim').textContent=state.map.claim;el.querySelector('.map-detail').hidden=true;state.focus=null;layout(id);for(const atomId of saved.openAtomIds??[])showAtom(id,atomId);state.focus=saved.focus;highlight(id,state.focus);requestAnimationFrame(()=>window.scrollTo({top:saved.scrollY,behavior:'instant'}));
    }
  });
  document.getElementById('reading-return').addEventListener('click',()=>{if(!readingReturn)return;const saved=readingReturn;readingReturn=null;document.getElementById('reading-return').hidden=true;window.scrollTo({top:saved.scrollY,behavior:'instant'});widget(saved.mapId)?.querySelector(`[data-open-atom="${CSS.escape(saved.atomId??'')}"]`)?.focus({preventScroll:true});});
  document.addEventListener('keydown',event=>{if(event.key!=='Enter'&&event.key!==' ')return;if(event.target.matches('.graph-edge-label')){event.preventDefault();showEdge(event.target.closest('.knowledge-map').dataset.mapId,event.target.dataset.edgeId);}else if(event.target.matches('[data-figure-atom]')){event.preventDefault();showFigurePart(event.target);}});
  const observer=new ResizeObserver(()=>{if(!resizeFrame)resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;for(const [id,state]of states){const el=widget(id);if(el.querySelector('.graph-viewport').clientWidth!==state.width)layout(id);}});});
  for(const map of knowledge.maps){layout(map.id);observer.observe(widget(map.id).querySelector('.graph-viewport'));}
  if(window.innerWidth<760){document.getElementById('structure-overview').hidden=true;document.getElementById('overview-toggle').setAttribute('aria-expanded','false');}
  document.fonts.ready.then(()=>{for(const id of states.keys())layout(id);});
  window.knowledgePilot={data:knowledge,inspect:()=>[...states].map(([id,state])=>({id,width:state.width,height:state.height,nodeIds:state.map.nodeIds,edgeIds:state.map.edgeIds,topology:state.topology,lanes:state.lanes,positions:[...(state.positions??[])].map(([id,p])=>({id,...p})),routes:state.routes??[]}))};
})();
