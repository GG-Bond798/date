(function(){
  // —— 全局状态 ——
  const state = {
    index: null,           // 来自 data/index.json（仅 people，无 posts 数组）
    people: [],            // 人物索引（每个人可附带其主导的帖子摘要与详情指针）
    postById: new Map(),   // postId -> 详情文件名（不规则），仅由 people 中提取
  };

  // —— DOM 简写 ——
  const $  = (s)=> document.querySelector(s);
  const $$ = (s)=> document.querySelectorAll(s);

  // —— 工具函数 ——
  const byLikesDesc = (a,b)=> (b.likes||0) - (a.likes||0);
  const byDateDesc  = (a,b)=> new Date(b.date||0) - new Date(a.date||0);
  const unique      = (arr)=> [...new Set(arr)].filter(Boolean);

  function maskName(name){
    if(!name) return "";
    if(name.length===1) return name + "*";
    if(name.length===2) return name[0] + "*";
    return name[0] + "*" + name.slice(-1);
  }

  // —— 关注（本地持久化） ——
  const FOLLOW_KEY = 'follow:people';
  const getFollowSet = ()=>{
    try { return new Set(JSON.parse(localStorage.getItem(FOLLOW_KEY)||'[]')); }
    catch { return new Set(); }
  };
  const saveFollowSet = (set)=> localStorage.setItem(FOLLOW_KEY, JSON.stringify([...set]));
  const isFollowed = (id)=> getFollowSet().has(String(id));
  const toggleFollow = (id)=>{
    const s = getFollowSet();
    const k = String(id);
    if(s.has(k)) s.delete(k); else s.add(k);
    saveFollowSet(s);
    return s.has(k);
  };

  // —— 从人物记录提取“主导帖子”元数据（兼容两种结构：扁平字段或 person.post 对象） ——
  function getPostMeta(person){
    // 兼容：扁平（title/summary/tags/likes/comments/date + post_id/file）
    const flatExists = person.title || person.summary || person.post_id || person.file;
    if(flatExists){
      return {
        id: person.post_id || person.post?.id,
        file: person.file || person.post?.file,
        title: person.title || person.post?.title,
        summary: person.summary || person.post?.summary,
        tags: person.tags || person.post?.tags || [],
        likes: person.likes || person.post?.likes || 0,
        comments: person.comments || person.post?.comments || 0,
        date: person.date || person.post?.date || person.last_report_at
      };
    }
    // 结构化：person.post
    if(person.post){
      const p = person.post;
      return {
        id: p.id, file: p.file, title: p.title, summary: p.summary,
        tags: p.tags||[], likes: p.likes||0, comments: p.comments||0, date: p.date || person.last_report_at
      };
    }
    return null;
  }

  // 将 people 中可用的帖子元数据摊平成列表（用于“最热/最新”）
  function postsFromPeople(){
    return state.people
      .map(person => {
        const m = getPostMeta(person);
        if(!m || !m.title) return null;
        return {
          personId: person.id,
          name_cn: person.name_cn,
          name_en: person.name_en,
          university: person.university,
          location: person.location,
          ...m
        };
      })
      .filter(Boolean);
  }

  // —— 路由 —— 形如：#/ 、#/hot 、#/discover 、#/post/<postId>
  function parseRoute(){
    const h = location.hash || '#/';
    if(h.startsWith('#/post/')) return { name:'post', id: h.slice('#/post/'.length) };
    if(h.startsWith('#/hot'))   return { name:'home', anchor:'#hot-section' };
    if(h.startsWith('#/discover')) return { name:'home', anchor:'#discover' };
    return { name:'home' };
  }

  function showView(id){
    $$('[data-view]').forEach(v=> v.hidden = true);
    $(id).hidden = false;
    window.scrollTo({ top:0, behavior:'instant' });
  }

  async function router(){
    const r = parseRoute();
    if(r.name==='post'){
      await renderPost(r.id);
      showView('#view-post');
    }else{
      showView('#view-home');
      if(r.anchor){
        const el = document.querySelector(r.anchor);
        if(el) el.scrollIntoView({ behavior:'smooth' });
      }
    }
  }

  // —— 数据加载 ——
  async function loadIndex(){
    if(state.index) return state.index;
    const res = await fetch('data/index.json', { cache:'no-store' });
    if(!res.ok) throw new Error('无法加载索引数据');
    const json = await res.json();
    state.index = json;
    state.people = json.people || [];

    // 建立 postId -> file 的映射，仅从 people 中提取
    state.postById.clear();
    for(const person of state.people){
      const m = getPostMeta(person);
      if(m && m.id && m.file){
        state.postById.set(m.id, m.file);
      }
    }
    return json;
  }

  async function loadPostDetail(postId){
    const file = state.postById.get(postId);
    if(!file) throw new Error('未找到对应帖子文件');
    const url = `data/posts/${file}`; // 不规则文件名，减少可枚举性
    const res = await fetch(url, { cache:'no-store' });
    if(!res.ok) throw new Error('无法加载帖子详情');
    return await res.json();
  }

  // —— 渲染：最热帖子（由 people 摊平而来） ——
  function renderHot(tab='week'){
    const list = $('#hot-list');
    list.innerHTML = '';

    let data = postsFromPeople();
    if(tab==='week'){
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-7);
      data = data.filter(p => new Date(p.date) >= cutoff);
    }else if(tab==='month'){
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-1);
      data = data.filter(p => new Date(p.date) >= cutoff);
    }
    data.sort(byLikesDesc);

    if(!data.length){ list.innerHTML = '<div class="muted">暂无数据</div>'; return; }

    for(const p of data){
      const card = document.createElement('article');
      card.className = 'hot-card';
      const linkHtml = p.id ? `<a href="#/post/${p.id}" target="_blank" rel="noopener">查看详情</a>` : `<button disabled title="暂无详情">查看详情</button>`;
      card.innerHTML = `
        <h3 title="${p.title}">${p.title}</h3>
        <div class="meta">${p.university||'-'} · ${p.location||'-'} · ${p.date||''}</div>
        <p>${p.summary||''}</p>
        <div class="tags">${(p.tags||[]).map(t=>`<span class='tag'>#${t}</span>`).join('')}</div>
        <div class="meta">👍 ${p.likes||0} · 💬 ${p.comments||0}</div>
        <div class="actions">${linkHtml}</div>
      `;
      list.appendChild(card);
    }
  }

  // —— 渲染：发现筛选（来自索引） ——
  function renderDiscoverFilters(){
    const regions = unique(state.index?.regions || []);
    const univs   = unique(state.index?.universities || []);
    const rf = $('#region-filters');
    const uf = $('#univ-filters');
    rf.innerHTML = regions.map(r=>`<button class="filter" data-r="${r}">${r}</button>`).join('');
    uf.innerHTML = univs.map(u=>`<button class="filter" data-u="${u}">${u}</button>`).join('');

    rf.addEventListener('click', e=>{
      if(e.target.matches('.filter')){
        $$('#region-filters .filter').forEach(b=>b.classList.remove('active'));
        e.target.classList.add('active');
        searchAndRender({ location:e.target.dataset.r });
      }
    });
    uf.addEventListener('click', e=>{
      if(e.target.matches('.filter')){
        $$('#univ-filters .filter').forEach(b=>b.classList.remove('active'));
        e.target.classList.add('active');
        searchAndRender({ univ:e.target.dataset.u });
      }
    });
  }

  // —— 搜索（仅索引字段；同时匹配标题/摘要） ——
  function searchPeople({ q='', gender='', location='', univ='' }){
    const key = q.trim().toLowerCase();
    return state.people.filter(p=>{
      const m = getPostMeta(p) || {};
      const corpus = [p.name_cn, p.name_en, p.university, m.title, m.summary].map(v=>String(v||'').toLowerCase());
      const matchKey    = !key || corpus.some(v=> v.includes(key));
      const matchGender = !gender || p.gender===gender;
      const matchLoc    = !location || p.location===location;
      const matchUniv   = !univ || p.university===univ;
      return matchKey && matchGender && matchLoc && matchUniv;
    });
  }

  function renderResults(rows){
    const list  = $('#result-list');
    const count = $('#result-count');
    list.innerHTML = '';

    const mask = $('#toggle-mask').checked;
    count.textContent = rows.length ? `共 ${rows.length} 条记录` : '暂无结果';

    for(const r of rows){
      const name = mask ? maskName(r.name_cn) : r.name_cn;
      const en   = mask ? maskName(r.name_en) : r.name_en;
      const followed = isFollowed(r.id);
      const m = getPostMeta(r) || {};

      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `
        <h3>${name} <span class="muted">(${en})</span></h3>
        <div class="meta">
          <span>性别：${r.gender||'-'}</span>
          <span>地区：${r.location||'-'}</span>
          <span>学校：${r.university||'-'}</span>
          <span>相关事件：${r.incidents||0} 条</span>
          <span>最近更新：${r.last_report_at||m.date||''}</span>
        </div>
        ${ m.title ? `<div class=\"badges\"><span class=\"badge\">#主导帖子</span>${(m.tags||[]).slice(0,2).map(t=>`<span class='badge'>#${t}</span>`).join('')}</div>` : ''}
        ${ m.title ? `<p class=\"muted\" style=\"margin:0;\">${m.title} — ${m.summary||''}</p>` : ''}
        <div class="actions">
          ${ m.id ? `<a href="#/post/${m.id}" target="_blank" rel="noopener">查看详情</a>` : `<button disabled title="暂无详情">查看详情</button>` }
          <button class="act-follow" data-person-id="${r.id}">${ followed ? '已关注' : '关注' }</button>
          <button class="act-report" data-person-id="${r.id}" data-person-name="${r.name_cn}">举报</button>
        </div>
      `;
      list.appendChild(card);
    }
  }

  function searchAndRender(overrides={}){
    const q       = $('#q').value;
    const gender  = $('#gender').value;
    const location= overrides.location ?? $('#location').value;
    const univ    = overrides.univ ?? $('#univ').value;
    const rows = searchPeople({ q, gender, location, univ });
    renderResults(rows);
  }

  // —— 帖子详情（全文与图片置于文末） ——
  async function renderPost(postId){
    const title = $('#post-title');
    const meta  = $('#post-meta');
    const content = $('#post-content');
    const gallery = $('#post-gallery');

    title.textContent = '加载中...';
    meta.textContent = '';
    content.innerHTML = '';
    gallery.innerHTML = '';

    try{
      const d = await loadPostDetail(postId);
      title.textContent = d.title || '';
      meta.textContent  = `${d.meta?.university||'-'} · ${d.meta?.location||'-'} · ${d.meta?.created_at||''}`;

      (d.content||[]).forEach(block=>{
        if(block.type==='p'){
          const p = document.createElement('p');
          p.textContent = block.text || '';
          content.appendChild(p);
        }
        // 可扩展更多 block 类型：h2、quote、ul/li 等
      });

      (d.images||[]).forEach(img=>{
        const el = document.createElement('img');
        el.loading = 'lazy';
        el.alt = img.alt || '';
        el.src = img.src; // 仅在详情页按需加载
        gallery.appendChild(el);
      });
    }catch(err){
      title.textContent = '内容加载失败';
      meta.textContent = '';
      content.textContent = '抱歉，暂时无法打开该帖子。';
      gallery.innerHTML = '';
    }
  }

  // —— 事件绑定 ——
  function bindEvents(){
    // 顶部“发布须知 / 申诉”
    $('#open-guidelines')?.addEventListener('click', ()=> $('#guidelines-modal').showModal());
    $('#open-take-down')?.addEventListener('click', ()=> $('#take-down-modal').showModal());
    $('#close-take-down')?.addEventListener('click', ()=> $('#take-down-modal').close());
    $('#take-down-form')?.addEventListener('submit', (e)=>{
      e.preventDefault();
      alert('已提交（演示）：我们将尽快处理您的请求。');
      $('#take-down-modal').close();
    });

    // 搜索提交
    $('#search-form').addEventListener('submit', (e)=>{ e.preventDefault(); searchAndRender(); });

    // Chip：最热/最新/按地区/按学校
    document.querySelector('.chips').addEventListener('click', (e)=>{
      const chip = e.target.closest('.chip');
      if(!chip) return;
      $$('.chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      const sort = chip.dataset.sort;
      if(sort==='hot') renderHot('week');
      if(sort==='new'){
        const list = $('#hot-list');
        list.innerHTML = '';
        postsFromPeople().sort(byDateDesc).forEach(p=>{
          const card = document.createElement('article');
          card.className='hot-card';
          const linkHtml = p.id ? `<a href="#/post/${p.id}" target="_blank" rel="noopener">查看详情</a>` : `<button disabled title="暂无详情">查看详情</button>`;
          card.innerHTML = `
            <h3>${p.title}</h3>
            <div class="meta">${p.university||'-'} · ${p.location||'-'} · ${p.date||''}</div>
            <p>${p.summary||''}</p>
            <div class="tags">${(p.tags||[]).map(t=>`<span class='tag'>#${t}</span>`).join('')}</div>
            <div class="meta">👍 ${p.likes||0} · 💬 ${p.comments||0}</div>
            <div class="actions">${linkHtml}</div>`;
          list.appendChild(card);
        });
      }
      if(chip.dataset.filter==='by-location' || chip.dataset.filter==='by-univ'){
        document.querySelector('#discover').scrollIntoView({ behavior:'smooth' });
      }
    });

    // 最热 tabs
    $$('.tab').forEach(t=> t.addEventListener('click', ()=>{
      $$('.tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      renderHot(t.dataset.hotTab);
    }));

    // 脱敏切换
    $('#toggle-mask').addEventListener('change', ()=> searchAndRender());

    // 路由
    window.addEventListener('hashchange', router);
  }

  // —— 初始化 ——
  async function init(){
    $('#year').textContent = new Date().getFullYear();
    try{
      await loadIndex();
    }catch(e){
      console.error(e);
      alert('加载索引失败：请确认 data/index.json 可访问');
      return;
    }

    // 下拉选项由索引填充
    const locSel  = $('#location');
    const univSel = $('#univ');
    (state.index.regions||[]).forEach(r=>{ const o=document.createElement('option'); o.value=o.textContent=r; locSel.appendChild(o); });
    (state.index.universities||[]).forEach(u=>{ const o=document.createElement('option'); o.value=o.textContent=u; univSel.appendChild(o); });

    renderHot('week');
    renderDiscoverFilters();
    bindEvents();
    searchAndRender();
    router();
  }

  document.addEventListener('DOMContentLoaded', init);
})();