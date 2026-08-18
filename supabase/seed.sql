-- Defaults. Safe to re-run.

insert into settings (key, value) values
  ('letter_words', '{
     "A":"APPLE","B":"BOY","C":"CAT","D":"DOG","E":"EQUAL","F":"FISH",
     "G":"GRAND","H":"HOUSE","I":"ISLAND","J":"JOY","K":"KING","L":"LOVE",
     "M":"MONEY","N":"NATION","O":"OCEAN"}'::jsonb),
  ('greeting', '"Dear All,"'::jsonb),
  ('footer', '"National Lotteries Authority. Results are provisional until certified by the Authority. In the event of a discrepancy, the official draw records prevail."'::jsonb),
  ('from_name', '"National Lotteries Authority"'::jsonb),
  ('eod_mode', '"draft"'::jsonb)   -- 'draft' stages the night blast for approval; 'send' auto-sends
on conflict (key) do nothing;

insert into recipient_groups (name, description) values
  ('All Results',   'Everyone who receives every blast'),
  ('Media',         'Radio, television and press desks'),
  ('Agents',        'Lottery agents and retail outlets'),
  ('Internal',      'NLA staff and management')
on conflict (name) do nothing;
