// 使用 Supabase 作为数据源的前端脚本（不再读取任何 JSON 文件）
(function () {
  // ---- 全局状态 ----
  const state = {
    index: null,        // { regions, universities, people }
    people: [],         // index_people 视图返回的行
    postById: new Map() // postId -> true（存在性）
  };

  // ---- DOM 简写 ----
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ---- 工具 ----
  const byLikesDesc = (a, b) => (b.likes || 0) - (a.likes || 0);
  const byDateDesc = (a, b) => new Date(b.date || 0) - new Date(a.date || 0);
  const unique = (arr) => [...new Set(arr)].filter(Boolean);

  function maskName(name) {
    if (!name) return "";
    if (name.length === 1) return name + "*";
    if (name.length === 2) return name[0] + "*";
    return name[0] + "*" + name.slice(-1);
  }

  // ---- 关注（本地）----
  const FOLLOW_KEY = "follow:people";
  const getFollowSet = () => {
    try { return new Set(JSON.parse(localStorage.getItem(FOLLOW_KEY) || "[]")); }
    catch { return new Set(); }
  };
  const saveFollowSet = (s) => localStorage.setItem(FOLLOW_KEY, JSON.stringify([...s]));
  const isFollowed = (id) => getFollowSet().has(String(id));
  const toggleFollow = (id) => {
    const s = getFollowSet(); const k = String(id);
    s.has(k) ? s.delete(k) : s.add(k);
    saveFollowSet(s);
    return s.has(k);
  };
  
  // 安全的匿名登录：仅在没有会话时登录；失败不阻塞
  async function ensureAnonAuth() {
    try {
      if (!window.supa || !window.supa.auth) return; // SDK/配置未加载时直接跳过
      const { data: { session } } = await window.supa.auth.getSession();
      if (!session) {
        await window.supa.auth.signInAnonymously();
      }
    } catch (e) {
      console.warn('Anon auth failed (ignored):', e && e.message ? e.message : e);
    }
  }

  // ---- 读取数据（Supabase）----
  async function loadIndex() {
    if (state.index) return state.index;
    // 读取视图：每个人最新一条 approved 帖子在字段 post 内
    const { data, error } = await window.supa.from("index_people").select("*");
    if (error) throw error;

    state.people = (data || []).map((r) => ({
      id: r.id,
      name_cn: r.name_cn,
      name_en: r.name_en,
      gender: r.gender,
      location: r.location,
      university: r.university,
      incidents: r.incidents,
      last_report_at: r.last_report_at,
      post: r.post || null
    }));

    state.postById.clear();
    state.people.forEach((p) => {
      const m = p.post;
      if (m && m.id) state.postById.set(m.id, true);
    });

    state.index = {
      regions: unique(state.people.map((x) => x.location)),
      universities: unique(state.people.map((x) => x.university)),
      people: state.people
    };
    return state.index;
  }

  // async function loadPostDetail(postId){
  //   // 先只取帖子本身，避免联表关系名不一致导致报错
  //   const { data, error } = await window.supa
  //     .from('posts')
  //     .select('id,title,summary,tags,likes,comments,date,created_at,content,images,person_id,status')
  //     .eq('id', postId)
  //     .maybeSingle(); // 不抛错，无行时返回 null

  //   if (error) throw error;
  //   if (!data || data.status !== 'approved') {
  //     throw new Error('NOT_FOUND_OR_UNAPPROVED');
  //   }

  //   // 用我们已加载的 index_people 映射 person 元信息（学校/地区）
  //   let meta = { university: '', location: '', created_at: data.created_at };
  //   const person = state.people.find(p => p.id === data.person_id);
  //   if (person) {
  //     meta.university = person.university || '';
  //     meta.location   = person.location   || '';
  //   }

  //   return {
  //     id: data.id,
  //     title: data.title,
  //     meta,
  //     content: data.content || [],
  //     images:  data.images  || []
  //   };
  // }


  async function loadPostDetail(postId){
  // Read from the safe view
  const { data, error } = await window.supa
    .from('public_posts')
    .select('id,person_id,title,summary,tags,date,created_at,content,images')
    .eq('id', postId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('NOT_FOUND_OR_UNAPPROVED');

  // Fill meta (university/location) from index_people already in memory
  let meta = { university: '', location: '', created_at: data.created_at };
  const person = state.people.find(p => p.id === data.person_id);
  if (person) {
    meta.university = person.university || '';
    meta.location   = person.location   || '';
  }

  return {
    id: data.id,
    title: data.title,
    meta,
    content: data.content || [],
    images:  data.images  || []
  };
}

  // ---- 从 people 提取帖子摘要 ----
  function getPostMeta(person) {
    return person.post || null;
  }

  function postsFromPeople() {
    return state.people
      .map((person) => {
        const m = getPostMeta(person);
        if (!m || !m.title) return null;
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

  // ---- 路由 ----
  function parseRoute() {
    const h = location.hash || "#/";
    if (h.startsWith("#/post/")) return { name: "post", id: h.slice("#/post/".length) };
    if (h.startsWith("#/hot")) return { name: "home", anchor: "#hot-section" };
    if (h.startsWith("#/discover")) return { name: "home", anchor: "#discover" };
    return { name: "home" };
  }

  function showView(id) {
    $$("[data-view]").forEach((v) => (v.hidden = true));
    const el = $(id);
    if (el) el.hidden = false;
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function router() {
    const r = parseRoute();
    if (r.name === "post") {
      await renderPost(r.id);
      showView("#view-post");
    } else {
      showView("#view-home");
      if (r.anchor) {
        const el = document.querySelector(r.anchor);
        if (el) el.scrollIntoView({ behavior: "smooth" });
      }
    }
  }

  // ---- 渲染：最热 ----
  function renderHot(tab = "week") {
    const list = $("#hot-list");
    if (!list) return;
    list.innerHTML = "";

    let data = postsFromPeople();
    if (tab === "week") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      data = data.filter((p) => new Date(p.date) >= cutoff);
    } else if (tab === "month") {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 1);
      data = data.filter((p) => new Date(p.date) >= cutoff);
    }
    // all：不过滤
    data.sort(byLikesDesc);

    if (!data.length) {
      list.innerHTML = '<div class="muted">暂无数据</div>';
      return;
    }

    for (const p of data) {
      const card = document.createElement("article");
      card.className = "hot-card";
      const linkHtml = p.id
        ? `<a class="open-post" data-post-id="${p.id}" href="#/post/${p.id}">查看详情</a>`
        : `<button disabled title="暂无详情">查看详情</button>`;
      card.innerHTML = `
        <h3 title="${p.title}">${p.title}</h3>
        <div class="meta">${p.university || "-"} · ${p.location || "-"} · ${p.date || ""}</div>
        <p>${p.summary || ""}</p>
        <div class="tags">${(p.tags || [])
          .map((t) => `<span class='tag'>#${t}</span>`)
          .join("")}</div>
        <div class="meta">👍 ${p.likes || 0} · 💬 ${p.comments || 0}</div>
        <div class="actions">${linkHtml}</div>
      `;
      list.appendChild(card);
    }
  }

  // ---- 渲染：发现筛选 ----
  function renderDiscoverFilters() {
    const regions = unique(state.index?.regions || []);
    const univs = unique(state.index?.universities || []);
    const rf = $("#region-filters");
    const uf = $("#univ-filters");
    if (!rf || !uf) return;

    rf.innerHTML = regions.map((r) => `<button class="filter" data-r="${r}">${r}</button>`).join("");
    uf.innerHTML = univs.map((u) => `<button class="filter" data-u="${u}">${u}</button>`).join("");

    rf.addEventListener("click", (e) => {
      if (e.target.matches(".filter")) {
        $$("#region-filters .filter").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        searchAndRender({ location: e.target.dataset.r });
      }
    });
    uf.addEventListener("click", (e) => {
      if (e.target.matches(".filter")) {
        $$("#univ-filters .filter").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        searchAndRender({ univ: e.target.dataset.u });
      }
    });
  }

  // ---- 搜索 ----
  function searchPeople({ q = "", gender = "", location = "", univ = "" }) {
    const key = q.trim().toLowerCase();
    return state.people.filter((p) => {
      const m = getPostMeta(p) || {};
      const corpus = [p.name_cn, p.name_en, p.university, m.title, m.summary].map((v) =>
        String(v || "").toLowerCase()
      );
      const matchKey = !key || corpus.some((v) => v.includes(key));
      const matchGender = !gender || p.gender === gender;
      const matchLoc = !location || p.location === location;
      const matchUniv = !univ || p.university === univ;
      return matchKey && matchGender && matchLoc && matchUniv;
    });
  }

  function renderResults(rows) {
    const list = $("#result-list");
    const count = $("#result-count");
    if (!list || !count) return;

    list.innerHTML = "";
    const mask = $("#toggle-mask")?.checked;
    count.textContent = rows.length ? `共 ${rows.length} 条记录` : "暂无结果";

    for (const r of rows) {
      const name = mask ? maskName(r.name_cn) : r.name_cn;
      const en = mask ? maskName(r.name_en) : r.name_en;
      const followed = isFollowed(r.id);
      const m = getPostMeta(r) || {};

      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <h3>${name} <span class="muted">(${en || "-"})</span></h3>
        <div class="meta">
          <span>性别：${r.gender || "-"}</span>
          <span>地区：${r.location || "-"}</span>
          <span>学校：${r.university || "-"}</span>
          <span>相关事件：${r.incidents || 0} 条</span>
          <span>最近更新：${r.last_report_at || m.date || ""}</span>
        </div>
        ${m.title ? `<div class="badges"><span class="badge">#主导帖子</span>${(m.tags || [])
          .slice(0, 2)
          .map((t) => `<span class='badge'>#${t}</span>`)
          .join("")}</div>` : ""}
        ${m.title ? `<p class="muted" style="margin:0;">${m.title} — ${m.summary || ""}</p>` : ""}
        <div class="actions">
          ${m.id
            ? `<a class="open-post" data-post-id="${m.id}" href="#/post/${m.id}">查看详情</a>`
            : `<button disabled title="暂无详情">查看详情</button>`}
          <button class="act-follow" data-person-id="${r.id}">${followed ? "已关注" : "关注"}</button>
          <button class="act-report" data-person-id="${r.id}" data-person-name="${r.name_cn}">举报</button>
        </div>
      `;
      list.appendChild(card);
    }
  }

  function searchAndRender(overrides = {}) {
    const q = $("#q")?.value || "";
    const gender = $("#gender")?.value || "";
    const location = overrides.location ?? ($("#location")?.value || "");
    const univ = overrides.univ ?? ($("#univ")?.value || "");

    // 关键词为空：不展示任何结果
    if (!q.trim()) {
      $("#result-list") && ($("#result-list").innerHTML = "");
      $("#result-count") && ($("#result-count").textContent = "请输入关键词后搜索");
      return;
    }
    const rows = searchPeople({ q, gender, location, univ });
    renderResults(rows);
  }

  // ---- 帖子详情 ----
  async function renderPost(postId) {
    const title = $("#post-title");
    const meta = $("#post-meta");
    const content = $("#post-content");
    const gallery = $("#post-gallery");
    if (!title) return;

    title.textContent = "加载中…";
    if (meta) meta.textContent = "";
    if (content) content.innerHTML = "";
    if (gallery) gallery.innerHTML = "";

    try {
      const d = await loadPostDetail(postId);
      title.textContent = d.title || "";
      if (meta) meta.textContent = `${d.meta?.university || "-"} · ${d.meta?.location || "-"} · ${d.meta?.created_at || ""}`;

      (d.content || []).forEach((block) => {
        if (block.type === "p" && content) {
          const p = document.createElement("p");
          p.textContent = block.text || "";
          content.appendChild(p);
        }
      });

      (d.images || []).forEach((img) => {
        if (!gallery) return;
        const el = document.createElement("img");
        el.loading = "lazy";
        el.alt = img.alt || "";
        el.src = img.src; // 仅详情页按需加载
        gallery.appendChild(el);
      });
      } catch (err) {
        title.textContent = '内容加载失败';
        if (content) {
          const msg = (err && err.message === 'NOT_FOUND_OR_UNAPPROVED')
            ? '未找到该帖子，或尚未通过审核。'
            : '抱歉，暂时无法打开该帖子。';
          content.innerHTML = `
            <p class="muted">${msg}</p>
            <p><a class="btn-link" href="#/">返回首页</a></p>
          `;
        }
      }
  }

  // ---- 事件绑定 ----
  function bindEvents() {
    // 顶部须知
    $("#open-guidelines")?.addEventListener("click", () => $("#guidelines-modal")?.showModal());

    // 搜索
    $("#search-form")?.addEventListener("submit", (e) => { e.preventDefault(); searchAndRender(); });
    $("#q")?.addEventListener("input", () => {
      if (!$("#q").value.trim()) {
        $("#result-list") && ($("#result-list").innerHTML = "");
        $("#result-count") && ($("#result-count").textContent = "请输入关键词后搜索");
      }
    });

    // Chips
    document.querySelector(".chips")?.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      $$(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const sort = chip.dataset.sort;
      if (sort === "hot") renderHot("week");
      if (sort === "new") {
        const list = $("#hot-list");
        if (!list) return;
        list.innerHTML = "";
        postsFromPeople().sort(byDateDesc).forEach((p) => {
          const card = document.createElement("article");
          card.className = "hot-card";
          const linkHtml = p.id
            ? `<a class="open-post" data-post-id="${p.id}" href="#/post/${p.id}">查看详情</a>`
            : `<button disabled>查看详情</button>`;
          card.innerHTML = `
            <h3>${p.title}</h3>
            <div class="meta">${p.university || "-"} · ${p.location || "-"} · ${p.date || ""}</div>
            <p>${p.summary || ""}</p>
            <div class="tags">${(p.tags || []).map((t) => `<span class='tag'>#${t}</span>`).join("")}</div>
            <div class="meta">👍 ${p.likes || 0} · 💬 ${p.comments || 0}</div>
            <div class="actions">${linkHtml}</div>
          `;
          list.appendChild(card);
        });
      }
      if (chip.dataset.filter === "by-location" || chip.dataset.filter === "by-univ") {
        document.querySelector("#discover")?.scrollIntoView({ behavior: "smooth" });
      }
    });

    // 最热 tabs
    $$(".tab").forEach((t) =>
      t.addEventListener("click", () => {
        $$(".tab").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        renderHot(t.dataset.hotTab);
      })
    );

    // 脱敏
    $("#toggle-mask")?.addEventListener("change", () => { if ($("#q")?.value.trim()) searchAndRender(); });

    // 结果按钮：关注/举报
    $("#result-list")?.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.classList.contains("act-follow")) {
        const on = toggleFollow(btn.dataset.personId);
        btn.textContent = on ? "已关注" : "关注";
      } else if (btn.classList.contains("act-report")) {
        $("#take-down-modal")?.showModal();
      }
    });

    // 详情链接兜底委托（确保一定切换 hash）
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a.open-post");
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.postId;
      if (id) location.hash = "#/post/" + id;
    });

    // 申诉弹窗关闭
    $("#close-take-down")?.addEventListener("click", () => $("#take-down-modal")?.close());

    // 路由
    window.addEventListener("hashchange", router);
  }

  // ---- 初始化 ----
  async function init() {
    await ensureAnonAuth();
    // 建议：匿名登录（若 supa-config.js 未做，可在此补一次）
    try { await window.supa?.auth?.signInAnonymously?.(); } catch {}

    $("#year") && ($("#year").textContent = new Date().getFullYear());
    try {
      await loadIndex();
    } catch (e) {
      console.error(e);
      alert("加载数据失败，请稍后重试");
      return;
    }

    // 下拉选项由索引填充
    const locSel = $("#location");
    const univSel = $("#univ");
    (state.index.regions || []).forEach((r) => {
      const o = document.createElement("option");
      o.value = o.textContent = r;
      locSel && locSel.appendChild(o);
    });
    (state.index.universities || []).forEach((u) => {
      const o = document.createElement("option");
      o.value = o.textContent = u;
      univSel && univSel.appendChild(o);
    });

    renderHot("week");
    renderDiscoverFilters();
    bindEvents();
    router();

    // 搜索区初始提示
    $("#result-list") && ($("#result-list").innerHTML = "");
    $("#result-count") && ($("#result-count").textContent = "请输入关键词后搜索");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
