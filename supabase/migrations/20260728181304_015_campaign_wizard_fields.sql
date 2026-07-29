alter table campaigns add column starting_level int not null default 1;
alter table campaigns add column min_players int not null default 1;
alter table campaigns add column max_players int not null default 5;
alter table campaigns add column ai_gm_tone text;
alter table campaigns add column ai_gm_rules_style text;
alter table campaigns add column ai_gm_lethality int;
alter table campaigns add column ai_gm_autonomy text;
