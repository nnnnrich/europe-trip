-- 歐洲行 app 的資料表與同步函式
-- 在 Supabase 後台 → SQL Editor 貼上全部內容 → Run

create sequence if not exists trip_items_rev;

create table if not exists public.trip_items (
  trip_code  text    not null,
  id         text    not null,
  kind       text    not null,
  data       jsonb   not null default '{}'::jsonb,
  updated_at bigint  not null,
  deleted    boolean not null default false,
  rev        bigint  not null default nextval('trip_items_rev'),
  primary key (trip_code, id)
);
create index if not exists trip_items_code_rev on public.trip_items (trip_code, rev);

-- 不開放直接讀寫資料表，只能透過下面兩個函式、而且要知道行程代碼
alter table public.trip_items enable row level security;
revoke all on public.trip_items from anon, authenticated;

create or replace function public.pull_items(p_code text, p_since bigint)
returns table (id text, kind text, data jsonb, updated_at bigint, deleted boolean, rev bigint)
language sql security definer set search_path = public as $$
  select t.id, t.kind, t.data, t.updated_at, t.deleted, t.rev
  from public.trip_items t
  where t.trip_code = p_code and length(p_code) >= 12 and t.rev > p_since
  order by t.rev;
$$;

create or replace function public.push_items(p_code text, p_items jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  if length(p_code) < 12 then raise exception 'trip code too short'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.trip_items as t (trip_code, id, kind, data, updated_at, deleted, rev)
    values (p_code, it->>'id', it->>'kind', coalesce(it->'data', '{}'::jsonb),
            (it->>'updated_at')::bigint, coalesce((it->>'deleted')::boolean, false), nextval('trip_items_rev'))
    on conflict (trip_code, id) do update
      set kind = excluded.kind, data = excluded.data, updated_at = excluded.updated_at,
          deleted = excluded.deleted, rev = excluded.rev
      where excluded.updated_at >= t.updated_at;
  end loop;
end $$;

revoke all on function public.pull_items(text, bigint) from public;
revoke all on function public.push_items(text, jsonb) from public;
grant execute on function public.pull_items(text, bigint) to anon, authenticated;
grant execute on function public.push_items(text, jsonb) to anon, authenticated;
