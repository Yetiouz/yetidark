alter table character_gear add column base_ac int;
alter table character_gear add column dex_applies boolean not null default true;
alter table character_gear add column is_shield boolean not null default false;
