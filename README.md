# 《北美留学的那些事儿》静态站点项目（纯前端 / 单击 index.html 即可运行）

> 说明：本项目仅为**演示用静态前端**，不含任何后端与数据库；所有数据均在浏览器本地内存中模拟。页面语言为中文，主色为 **#202bf5**（RGB 32,43,245）。请务必在真实上线前加入**内容审核、证据校验、隐私与反诽谤合规流程**（见下文“合规与安全设计”）。





## Table Schema
```sql
-- 方便生成随机主键

-- 人物（人为主导）
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name_cn text not null,
  name_en text,
  gender text check (gender in ('男','女','其他')),
  location text,
  university text,
  incidents_count int default 0,
  last_report_at date,
  created_at timestamptz default now()
);

-- 帖子（详情，归属某人）
create table if not exists public.posts (
  id text primary key default ('p-' || encode(gen_random_bytes(6),'hex')),
  person_id uuid not null references public.people(id) on delete cascade,
  title text not null,
  summary text,
  tags text[] default '{}',
  likes int default 0,
  comments int default 0,
  date date default (now()::date),
  created_at timestamptz default now(),
  content jsonb default '[]'::jsonb,  -- [{type:'p', text:'...'}]
  images  jsonb default '[]'::jsonb,  -- [{src:'https://...', alt?:'...'}]
  status text not null default 'pending'
);

-- 投稿队列表（前端匿名用户只写入这里，不能读）
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,       -- { person:{...}, post:{...}, contact }
  contact text,
  created_at timestamptz default now(),
  ip inet,
  ua text
);

-- 视图：给前端“索引/热榜/搜索”用，只暴露每个人最新一条 approved 帖子
create or replace view public.index_people as
select
  p.id,
  p.name_cn,
  p.name_en,
  p.gender,
  p.location,
  p.university,
  greatest(coalesce(p.incidents_count,0), 1) as incidents,  -- 至少显示 1
  coalesce(p.last_report_at, now()::date) as last_report_at,
  (
    select jsonb_build_object(
      'id', po.id,
      'title', po.title,
      'summary', po.summary,
      'tags', po.tags,
      'likes', po.likes,
      'comments', po.comments,
      'date', po.date
    )
    from public.posts po
    where po.person_id = p.id and po.status = 'approved'
    order by po.date desc, po.created_at desc
    limit 1
  ) as post
from public.people p
where exists (
  select 1 from public.posts x where x.person_id = p.id and x.status = 'approved'
);

-- 命中我们常用查询的索引（很重要）
create index if not exists posts_person_status_date_idx
  on public.posts (person_id, status, date desc, created_at desc);

create index if not exists people_university_idx on public.people (university);
create index if not exists people_location_idx   on public.people (location);
create index if not exists people_created_idx    on public.people (created_at desc);

```


1) **数据拆分与最小暴露**：
   - 列表/搜索仅使用 `data/index.json`（去敏 + 无全文 + 无图片清单）。
   - 单帖全文与图片列表位于独立 `data/posts/<随机文件名>.json`，仅在进入详情页按需加载。
2) **不可枚举的路径**：
   - 详情文件名使用不规则ID（非自增），并可分层目录（如 `data/posts/a1/8f1c3a.json`）。
3) **关闭目录索引**：
   - Nginx/Apache 关闭目录浏览（Apache 例：`.htaccess` 加 `Options -Indexes`）。
4) **反爬与速率**（可选，前端层面有限）：
   - 使用 CDN/WAF 的速率限制、UA 校验；
   - `robots.txt` 禁爬；
   - 不提供“全部ID列表”的站点地图；
   - 图片与 JSON 使用**按需加载**；
5) **更强保护（需后端/边缘函数）**：
   - 对 `data/posts/*` 进行鉴权、签名 URL、或 AES-GCM 加密 + 前端解密（密钥通过用户会话获取），再结合日志审计与滥用检测。





