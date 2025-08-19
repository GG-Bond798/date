(function(){
  const state = { index:null, people:[], postById:new Map() };
  const $ = (s)=>document.querySelector(s); const $$=(s)=>document.querySelectorAll(s);
  const byLikesDesc=(a,b)=>(b.likes||0)-(a.likes||0); const byDateDesc=(a,b)=>new Date(b.date||0)-new Date(a.date||0);
  const unique=(arr)=>[...new Set(arr)].filter(Boolean);
  function maskName(name){ if(!name) return ""; if(name.length===1) return name+"*"; if(name.length===2) return name[0]+"*"; return name[0]+"*"+name.slice(-1); }

  const FOLLOW_KEY='follow:people';
  const getFollowSet=()=>{ try{return new Set(JSON.parse(localStorage.getItem(FOLLOW_KEY)||'[]'))}catch{return new Set()} };
  const saveFollowSet=(s)=>localStorage.setItem(FOLLOW_KEY, JSON.stringify([...s]));
  const isFollowed=(id)=>getFollowSet().has(String(id));
  const toggleFollow=(id)=>{ const s=getFollowSet(); const k=String(id); s.has(k)?s.delete(k):s.add(k); saveFollowSet(s); return s.has(k); };

  function getPostMeta(person){ return person.post || null; }
  function postsFromPeople(){ return state.people.map(p=>{
    const m=getPostMeta(p); if(!m||!m.title) return null; return { personId:p.id, name_cn:p.name_cn, name_en:p.name_en, university:p.university, location:p.location, ...m };
  }).filter(Boolean); }

  function parseRoute(){ const h=location.hash||'#/' ; if(h.startsWith('#/post/')) return {name:'post', id:h.slice('#/post/'.length)}; if(h.startsWith('#/hot')) return {name:'home', anchor:'#hot-section'}; if(h.startsWith('#/discover')) return {name:'home', anchor:'#discover'}; return {name:'home'}; }
  function showView(id){ $$('[data-view]').forEach(v=>v.hidden=true); $(id).hidden=false; window.scrollTo({top:0, behavior:'instant'}); }
  async function router(){ const r=parseRoute(); if(r.name==='post'){ await renderPost(r.id); showView('#view-post'); }else{ showView('#view-home'); if(r.anchor){ const el=document.querySelector(r.anchor); if(el) el.scrollIntoView({behavior:'smooth'}); } } }

  // —— 数据：从视图 index_people 读取 ——
  async function loadIndex(){
    if(state.index) return state.index;
    const { data, error } = await window.supa.from('index_people').select('*');
    if(error) throw error;
    // 组装与原前端一致的结构
    state.people = (data||[]).map(r=>({
      id:r.id, name_cn:r.name_cn, name_en:r.name_en, gender:r.gender, location:r.location, university:r.university,
      incidents:r.incidents, last_report_at:r.last_report_at, post:r.post || null
    }));
    state.postById.clear();
    state.people.forEach(p=>{ const m=p.post; if(m&&m.id){ state.postById.set(m.id, true); } });
    state.index = {
      regions: unique(state.people.map(x=>x.location)),
      universities: unique(state.people.map(x=>x.university)),
      people: state.people
    };
    return state.index;
  }

  // —— 详情：直接查 posts（只会返回已审核） ——
  async function loadPostDetail(postId){
    const sel = `id,title,summary,tags,likes,comments,date,created_at,content,images,person:people(university,location)`;
    const { data, error } = await window.supa.from('posts').select(sel).eq('id', postId).eq('status','approved').single();
    if(error) throw error;
    return {
      id:data.id,
      title:data.title,
      meta:{ university:data.person?.university||'', location:data.person?.location||'', created_at:data.created_at },
      content:data.content||[],
      images:data.images||[]
    };
  }

  function renderHot(tab='week'){
    const list=$('#hot-list'); list.innerHTML='';
    let data=postsFromPeople();
    if(tab==='week'){ const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-7); data=data.filter(p=>new Date(p.date)>=cutoff); }
    else if(tab==='month'){ const cutoff=new Date(); cutoff.setMonth(cutoff.getMonth()-1); data=data.filter(p=>new Date(p.date)>=cutoff); }
    data.sort(byLikesDesc);
    if(!data.length){ list.innerHTML='<div class="muted">暂无数据</div>'; return; }
    for(const p of data){
      const card=document.createElement('article'); card.className='hot-card';
      const linkHtml=p.id?`<a href="#/post/${p.id}" target="_blank" rel="noopener">查看详情</a>`:`<button disabled title="暂无详情">查看详情</button>`;
      card.innerHTML = `
        <h3 title="${p.title}">${p.title}</h3>
        <div class="meta">${p.university||'-'} · ${p.location||'-'} · ${p.date||''}</div>
        <p>${p.summary||''}</p>
        <div class="tags">${(p.tags||[]).map(t=>`<span class='tag'>#${t}</span>`).join('')}</div>
        <div class="meta">👍 ${p.likes||0} · 💬 ${p.comments||0}</div>
        <div class="actions">${linkHtml}</div>`;
      list.appendChild(card);
    }
  }

  function renderDiscoverFilters(){
    const regions=unique(state.index?.regions||[]); const univs=unique(state.index?.universities||[]);
    const rf=$('#region-filters'), uf=$('#univ-filters');
    rf.innerHTML = regions.map(r=>`<button class="filter" data-r="${r}">${r}</button>`).join('');
    uf.innerHTML = univs.map(u=>`<button class="filter" data-u="${u}">${u}</button>`).join('');
    rf.addEventListener('click', e=>{ if(e.target.matches('.filter')){ $$('#region-filters .filter').forEach(b=>b.classList.remove('active')); e.target.classList.add('active'); searchAndRender({location:e.target.dataset.r}); }});
    uf.addEventListener('click', e=>{ if(e.target.matches('.filter')){ $$('#univ-filters .filter').forEach(b=>b.classList.remove('active')); e.target.classList.add('active'); searchAndRender({univ:e.target.dataset.u}); }});
  }

  function searchPeople({q='',gender='',location='',univ=''}){
    const key=q.trim().toLowerCase();
    return state.people.filter(p=>{
      const m=getPostMeta(p)||{}; const corpus=[p.name_cn,p.name_en,p.university,m.title,m.summary].map(v=>String(v||'').toLowerCase());
      const matchKey=!key||corpus.some(v=>v.includes(key));
      const matchGender=!gender||p.gender===gender; const matchLoc=!location||p.location===location; const matchUniv=!univ||p.university===univ; return matchKey&&matchGender&&matchLoc&&matchUniv;
    });
  }

  function renderResults(rows){
    const list=$('#result-list'); const count=$('#result-count'); list.innerHTML='';
    const mask=$('#toggle-mask').checked; count.textContent=rows.length?`共 ${rows.length} 条记录`:'暂无结果';
    for(const r of rows){
      const name=mask?maskName(r.name_cn):r.name_cn; const en=mask?maskName(r.name_en):r.name_en; const followed=isFollowed(r.id); const m=getPostMeta(r)||{};
      const card=document.createElement('article'); card.className='card';
      card.innerHTML=`
        <h3>${name} <span class="muted">(${en})</span></h3>
        <div class="meta">
          <span>性别：${r.gender||'-'}</span>
          <span>地区：${r.location||'-'}</span>
          <span>学校：${r.university||'-'}</span>
          <span>相关事件：${r.incidents||0} 条</span>
          <span>最近更新：${r.last_report_at||m.date||''}</span>
        </div>
        ${ m.title ? `<div class="badges"><span class="badge">#主导帖子</span>${(m.tags||[]).slice(0,2).map(t=>`<span class='badge'>#${t}</span>`).join('')}</div>` : ''}
        ${ m.title ? `<p class="muted" style="margin:0;">${m.title} — ${m.summary||''}</p>` : ''}
        <div class="actions">
          ${ m.id ? `<a href="#/post/${m.id}" target="_blank" rel="noopener">查看详情</a>` : `<button disabled title="暂无详情">查看详情</button>` }
          <button class="act-follow" data-person-id="${r.id}">${ followed ? '已关注' : '关注' }</button>
          <button class="act-report" data-person-id="${r.id}" data-person-name="${r.name_cn}">举报</button>
        </div>`;
      list.appendChild(card);
    }
  }

  function searchAndRender(overrides={}){
    const q=$('#q').value; const gender=$('#gender').value; const location=overrides.location ?? $('#location').value; const univ=overrides.univ ?? $('#univ').value;
    if(!q.trim()){ $('#result-list').innerHTML=''; $('#result-count').textContent='请输入关键词后搜索'; return; }
    renderResults( searchPeople({ q, gender, location, univ }) );
  }

  async function renderPost(postId){
    const title=$('#post-title'), meta=$('#post-meta'), content=$('#post-content'), gallery=$('#post-gallery');
    title.textContent='加载中...'; meta.textContent=''; content.innerHTML=''; gallery.innerHTML='';
    try{
      const d=await loadPostDetail(postId);
      title.textContent=d.title||''; meta.textContent=`${d.meta?.university||'-'} · ${d.meta?.location||'-'} · ${d.meta?.created_at||''}`;
      (d.content||[]).forEach(b=>{ if(b.type==='p'){ const p=document.createElement('p'); p.textContent=b.text||''; content.appendChild(p); }});
      (d.images||[]).forEach(img=>{ const el=document.createElement('img'); el.loading='lazy'; el.alt=img.alt||''; el.src=img.src; gallery.appendChild(el); });
    }catch{ title.textContent='内容加载失败'; content.textContent='抱歉，暂时无法打开该帖子。'; }
  }

  function bindEvents(){
    $('#open-guidelines')?.addEventListener('click', ()=> $('#guidelines-modal').showModal());
    $('#open-take-down')?.addEventListener('click', ()=> $('#take-down-modal').showModal());
    $('#close-take-down')?.addEventListener('click', ()=> $('#take-down-modal').close());
    $('#take-down-form')?.addEventListener('submit', (e)=>{ e.preventDefault(); alert('已提交（演示）'); $('#take-down-modal').close(); });

    $('#search-form').addEventListener('submit', (e)=>{ e.preventDefault(); searchAndRender(); });
    $('#q').addEventListener('input', ()=>{ if(!$('#q').value.trim()){ $('#result-list').innerHTML=''; $('#result-count').textContent='请输入关键词后搜索'; }});

    document.querySelector('.chips').addEventListener('click', (e)=>{
      const chip=e.target.closest('.chip'); if(!chip) return; $$('.chip').forEach(c=>c.classList.remove('active')); chip.classList.add('active');
      const sort=chip.dataset.sort; if(sort==='hot') renderHot('week'); if(sort==='new'){ const list=$('#hot-list'); list.innerHTML=''; postsFromPeople().sort(byDateDesc).forEach(p=>{ const card=document.createElement('article'); card.className='hot-card'; const linkHtml=p.id?`<a href="#/post/${p.id}" target="_blank" rel="noopener">查看详情</a>`:`<button disabled>查看详情</button>`; card.innerHTML=`<h3>${p.title}</h3><div class='meta'>${p.university||'-'} · ${p.location||'-'} · ${p.date||''}</div><p>${p.summary||''}</p><div class='tags'>${(p.tags||[]).map(t=>`<span class='tag'>#${t}</span>`).join('')}</div><div class='meta'>👍 ${p.likes||0} · 💬 ${p.comments||0}</div><div class='actions'>${linkHtml}</div>`; list.appendChild(card); }); }
      if(chip.dataset.filter==='by-location'||chip.dataset.filter==='by-univ'){ document.querySelector('#discover').scrollIntoView({behavior:'smooth'}); }
    });

    $$('.tab').forEach(t=> t.addEventListener('click', ()=>{ $$('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active'); renderHot(t.dataset.hotTab); }));
    $('#toggle-mask').addEventListener('change', ()=>{ if($('#q').value.trim()) searchAndRender(); });
    $('#result-list').addEventListener('click', (e)=>{ const btn=e.target.closest('button'); if(!btn) return; if(btn.classList.contains('act-follow')){ const on=toggleFollow(btn.dataset.personId); btn.textContent=on?'已关注':'关注'; } else if(btn.classList.contains('act-report')){ const input=document.querySelector('#take-down-form [name="target"]'); if(input) input.value=`关于 ${btn.dataset.personName||''} 的内容申诉`; $('#take-down-modal').showModal(); }});
    window.addEventListener('hashchange', router);
  }

  async function init(){
    $('#year').textContent=new Date().getFullYear();
    try{ await loadIndex(); }catch(e){ console.error(e); alert('加载数据失败，请稍后重试'); }
    const locSel=$('#location'), univSel=$('#univ'); (state.index.regions||[]).forEach(r=>{ const o=document.createElement('option'); o.value=o.textContent=r; locSel.appendChild(o); }); (state.index.universities||[]).forEach(u=>{ const o=document.createElement('option'); o.value=o.textContent=u; univSel.appendChild(o); });
    renderHot('week'); renderDiscoverFilters(); bindEvents(); router();
    $('#result-list').innerHTML=''; $('#result-count').textContent='请输入关键词后搜索';
  }
  document.addEventListener('DOMContentLoaded', init);
})();