-- Momentum+ migration 0066 (Matt, 2026-07-29): the "Become a partner"
-- banner at the bottom of the member Sponsors page joins the Ad Manager —
-- until now its copy and link were hard-coded in the page. This adds the
-- slot and seeds the current banner as an editable notice row; the page
-- now renders whatever this slot holds (falling back to the old copy only
-- if the slot is emptied of active rows).

insert into ad_placements (key, label, description, sort)
values (
  'sponsors_footer',
  'Sponsors page footer',
  'The banner at the bottom of the member Sponsors page — the "Become a partner" call-to-action lives here.',
  50
)
on conflict (key) do nothing;

insert into ads (placement_key, kind, title, body, cta_label, url, sort)
select 'sponsors_footer', 'notice', 'Become a partner',
       'Put your brand in front of a national community of engaged leaders — tasteful, integrated, and measured. This season''s sponsorships are full; submissions are considered when 2027 sponsorships open in April 2027.',
       'Sponsorship Interest Form',
       'https://event.tristateleadershipsummit.com/sponsor',
       10
where not exists (
  select 1 from ads a where a.placement_key = 'sponsors_footer'
);
