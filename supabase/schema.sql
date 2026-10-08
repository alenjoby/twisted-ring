-- ==============================================================================
-- TWISTED RING // SUPABASE DATABASE SCHEMA & REALTIME MIGRATION
-- ==============================================================================

-- 1. PROFILES TABLE (Player Stats & Leaderboard)
create table if not exists public.profiles (
  id text primary key,
  name text not null,
  total_matches integer default 0,
  wins integer default 0,
  kills integer default 0,
  high_score integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for profiles
alter table public.profiles enable row level security;

-- Allow public read access to leaderboard and profiles
create policy "Public profiles are viewable by everyone"
  on public.profiles for select
  using (true);

-- Allow players to insert their profile
create policy "Players can insert their profile"
  on public.profiles for insert
  with check (true);

-- Allow players to update their profile stats
create policy "Players can update their profile"
  on public.profiles for update
  using (true);


-- 2. MATCH ROOMS TABLE (Lobby Matchmaking & Public Sectors)
create table if not exists public.match_rooms (
  id text primary key,
  name text not null,
  host_id text,
  is_private boolean default false,
  player_count integer default 1,
  max_players integer default 5,
  status text default 'waiting', -- 'waiting' | 'in_progress' | 'finished'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for match_rooms
alter table public.match_rooms enable row level security;

-- Allow anyone to view rooms
create policy "Rooms are viewable by everyone"
  on public.match_rooms for select
  using (true);

-- Allow players to create rooms
create policy "Players can create rooms"
  on public.match_rooms for insert
  with check (true);

-- Allow room updates (player counts, status)
create policy "Players can update rooms"
  on public.match_rooms for update
  using (true);

-- Allow room deletion when empty
create policy "Players can delete rooms"
  on public.match_rooms for delete
  using (true);


-- 3. ENABLE SUPABASE REALTIME PUBLICATION
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'match_rooms'
  ) then
    alter publication supabase_realtime add table public.match_rooms;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- 4. HELPER TRIGGER FOR UPDATED_AT
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_profiles_updated
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

create trigger on_rooms_updated
  before update on public.match_rooms
  for each row execute procedure public.handle_updated_at();
