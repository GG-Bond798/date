# 《北美留学的那些瓜》静态站点项目（纯前端 / 单击 index.html 即可运行）

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


### Build approve submission

```sql
-- 先删旧签名，防止并存
drop function if exists public.approve_submission(uuid, uuid);

-- 用 md5(random()||clock_timestamp()) 生成 12 位十六进制片段，前缀保留 'p-'
create or replace function public.approve_submission(sub_id uuid, in_person_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pay jsonb;
  p_id uuid;
  p_name_cn text; p_name_en text; p_gender text; p_univ text; p_loc text;
  post_title text; post_summary text; post_date date;
  post_tags text[]; post_content jsonb; post_images jsonb;
  new_post_id text;
begin
  select payload into pay from public.submissions where id = sub_id;
  if pay is null then
    raise exception 'submission % not found', sub_id;
  end if;

  -- 提取字段
  p_name_cn := pay->'person'->>'name_cn';
  p_name_en := pay->'person'->>'name_en';
  p_gender  := pay->'person'->>'gender';
  p_univ    := pay->'person'->>'university';
  p_loc     := pay->'person'->>'location';

  post_title   := pay->'post'->>'title';
  post_summary := pay->'post'->>'summary';
  post_date    := coalesce((pay->'post'->>'date')::date, now()::date);
  post_content := coalesce(pay->'post'->'content','[]'::jsonb);
  post_images  := coalesce(pay->'post'->'images','[]'::jsonb);
  select coalesce(array_agg(x), '{}') into post_tags
    from jsonb_array_elements_text(coalesce(pay->'post'->'tags','[]'::jsonb)) as t(x);

  -- 选已有 person 或自动匹配/新建
  if in_person_id is not null then
    p_id := in_person_id;
  else
    select id into p_id
    from public.people
    where lower(trim(coalesce(name_cn,''))) = lower(trim(coalesce(p_name_cn,'')))
      and lower(trim(coalesce(university,''))) = lower(trim(coalesce(p_univ,'')))
      and lower(trim(coalesce(location,'')))   = lower(trim(coalesce(p_loc,'')))
    limit 1;

    if p_id is null and coalesce(p_name_en,'') <> '' then
      select id into p_id
      from public.people
      where lower(trim(coalesce(name_en,''))) = lower(trim(coalesce(p_name_en,'')))
        and lower(trim(coalesce(university,''))) = lower(trim(coalesce(p_univ,'')))
        and lower(trim(coalesce(location,'')))   = lower(trim(coalesce(p_loc,'')))
      limit 1;
    end if;

    if p_id is null then
      insert into public.people(name_cn, name_en, gender, location, university, last_report_at)
      values (p_name_cn, p_name_en, p_gender, p_loc, p_univ, post_date)
      returning id into p_id;
    end if;
  end if;

  -- ✅ 不依赖扩展的 ID 生成（48bit 十六进制，冲突概率极低，PK 若冲突会报错）
  new_post_id := 'p-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

  insert into public.posts(id, person_id, title, summary, tags, date, content, images, status)
  values (new_post_id, p_id, post_title, post_summary, post_tags, post_date, post_content, post_images, 'approved');

  -- 刷新人物统计（若已建触发器也可以省略）
  perform public.refresh_person_stats(p_id);

  -- 可选：标记投稿已处理
  alter table public.submissions
    add column if not exists processed_at timestamptz;
  update public.submissions set processed_at = now() where id = sub_id;

  return new_post_id;
end $$;

```


### Build Soft/hard delete

```sql
-- 供软删记录时间（若不存在就加）
alter table public.posts
  add column if not exists removed_at timestamptz;

-- 软删除帖子：改状态为 rejected + 标记时间；刷新人物统计
create or replace function public.soft_remove_post(_post_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  select person_id into pid from public.posts where id = _post_id;
  if pid is null then
    raise exception 'post % not found', _post_id;
  end if;

  update public.posts
     set status='rejected', removed_at = now()
   where id = _post_id;

  perform public.refresh_person_stats(pid);
end $$;

-- 硬删除帖子：从表中移除；刷新人物统计
create or replace function public.hard_delete_post(_post_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  select person_id into pid from public.posts where id = _post_id;
  if pid is null then
    raise exception 'post % not found', _post_id;
  end if;

  delete from public.posts where id = _post_id;

  perform public.refresh_person_stats(pid);
end $$;

-- 软删除整个人：把该人的所有帖改为 rejected（索引页自然隐藏）
create or replace function public.soft_remove_person(_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.posts
     set status='rejected', removed_at = now()
   where person_id = _person_id;
  perform public.refresh_person_stats(_person_id);
end $$;

-- 硬删除整个人：删除该人及其所有帖子（posts 上有 on delete cascade 即可）
create or replace function public.hard_delete_person(_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.people where id = _person_id;  -- 其 posts 会随之级联删除
end $$;

-- 权限：仅服务侧可执行（不要给 anon）
revoke all on function public.soft_remove_post(text)   from public;
revoke all on function public.hard_delete_post(text)   from public;
revoke all on function public.soft_remove_person(uuid) from public;
revoke all on function public.hard_delete_person(uuid) from public;

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





