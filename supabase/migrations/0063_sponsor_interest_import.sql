-- 2026 sponsor interest-list import (Matt, 2026-07-29). Source: the GHL
-- sponsor interest form export (event.tristateleadershipsummit.com/sponsor).
-- Requires 0062 (prospect + contact columns, new tiers).
--
-- Every business lands as a PROSPECT: hidden from members, no term, no
-- seats, no accounts — and NO emails. Matt confirms each one from Admin →
-- Sponsors once the agreement is signed.
--
-- ONE statement on purpose: the Supabase SQL editor runs statements over a
-- connection pool, so a temp table created in one statement is gone by the
-- next (the v1 of this file failed exactly that way). Data-modifying CTEs
-- keep the whole import atomic on a single connection.
--
-- Idempotent, and it never duplicates: a business already in the sponsors
-- table (several 2025-season sponsors re-submitted for 2026) is skipped by
-- the insert; instead the UPDATE gives its existing row the 2026 interest
-- note + any missing contact info (the UPDATE's snapshot predates the
-- insert, so freshly inserted prospects are untouched). Re-running is a
-- no-op: the insert finds the rows exist, the update sees their notes
-- already carry "2026 interest".

with v (name, tier, description, website, contact_name, contact_email, contact_phone, notes) as (
  values
  ('Meinelschmidt Distillery', 'happy_hour',
   '',
   'https://www.meineldistillery.com',
   'Cort Meinelschmidt', 'cort@meineldistillery.com', '+13019928777',
   '2026 interest: Networking Happy Hour Sponsor ($6,500). Also owns Veva''s on Potomac (vevasonpotomac.com). Description coming from their marketing contact. Submitted Jul 22, 2026.'),

  ('TOBE DesignGroup', 'silver',
   'TOBE DesignGroup is an award winning interior architecture + design firm. Our areas of practice include commercial, multifamily, and residential spaces. Design is personal. It''s more than creating beautiful interiors—it''s about understanding the people who will live, work, gather, and grow within them. At TOBE DesignGroup, we believe the strongest projects begin with trust, collaboration, and a genuine commitment to understanding what matters most.',
   'https://www.tobedesigngroup.com',
   'Todd Howard Ezrin', 'todd@tobedesigngroup.com', '+13016566600',
   '2026 interest: Silver Sponsor ($2,500). Principal (pronounced "Toby"). Submitted Jul 18, 2026.'),

  ('Graphics Universal, Inc.', 'silver',
   'Graphics Universal, Inc. is a label and commercial print manufacturer specializing in high-quality pressure-sensitive labels and custom printing services. The company provides innovative print solutions designed to enhance brand awareness, product presentation and overall operational efficiency.',
   'https://www.graphicsuniversal.com',
   'Adam Wiestling', 'adam@graphicsuniversal.com', '+17178169999',
   '2026 interest: Silver Sponsor ($2,500). Partnership previously discussed with Sierra. Sales Representative. Submitted Jun 25, 2026.'),

  ('Connect Films', 'silver',
   'At Connect Films, we actually don''t sell videos. We sell strategic clarity. Most of our clients come to us because there is a gap between how brilliant they are and how the market perceives them. We build the narrative strategy to close that gap, and the video is just the vehicle we use to deliver it.',
   'https://www.connectfilms.com',
   'Josh Youngbar', 'josh@connectfilms.com', '+13019911642',
   '2026 interest: Silver Sponsor ($2,500) — proposes trade for video production. Founder. Submitted Jun 18, 2026.'),

  ('Allegany County Chamber of Commerce', 'community',
   'The Allegany County Chamber of Commerce serves as a valued investment and resource for the business community through leadership, advocacy, education, and networking.',
   'https://alleganycountychamber.com',
   'Juli McCoy', 'juli@alleganycountychamber.com', '+13017222820',
   '2026 interest: Community Sponsor ($750). President & CEO. Submitted Jun 2, 2026.'),

  ('Frederick County Chamber of Commerce', 'community',
   'The Frederick County Chamber of Commerce serves as the voice of business within Frederick County, and provides strategic leadership and engagement in building the future of business and the community through information, collaboration, advocacy and services on behalf of the employers in our community.',
   'https://www.frederickchamber.org',
   'Casey Beins', 'cbeins@frederickchamber.org', '+12408156801',
   '2026 interest: Community Sponsor ($750) — proposes trade. Director of Marketing & Communications. Submitted Jun 1, 2026.'),

  ('Smartypants Medicine', 'silver',
   'Smartypants Medicine delivers personalized, convenient, affordable primary care to Winchester, VA and beyond. As a Direct Primary Care practice, we offer direct communication with your primary care provider via email, call, text, telehealth, office visits, and house calls. We work with both individuals and employers. Smart patients. Smart Healthcare. Smartypants Medicine.',
   'https://smartypantsmedicine.com',
   'Kelly Botta', 'kelly.a.botta@gmail.com', '+15406926132',
   '2026 interest: Silver Sponsor ($2,500) — "I think this is the level I told Sierra we wanted". President / Founder (pronounced BOT-ahh). Submitted May 14, 2026.'),

  ('RM Benefits', 'coffee_break',
   'RM Benefits includes RM Benefits of Maryland (owned by Rose McNeely) and RM Benefits Retirement Consulting (owned by Trish Davies). Together we offer complete, comprehensive, and custom employee benefit packages to attract and retain the best.',
   'https://www.rmbenefitsmd.com',
   'Trish Davies', 'trish.davies@lpl.com', '+12404226760',
   '2026 interest: Coffee Break Sponsor ($2,500). Referred by Mary Sue Dahill after attending a previous event. NOTE: exclusive package — River Bottom Roasters asked for it too. Submitted May 11, 2026.'),

  ('Saunders Tax and Accounting', 'silver',
   'Less Taxing Life, More Prosperous Solutions. Saunders Tax & Accounting helps individuals and business owners simplify the financial side of life and business. Through proactive tax planning, accounting, and strategic guidance, we help clients reduce tax burdens, make confident decisions, and create stronger financial outcomes.',
   'https://www.saunderstax.com',
   'Bev Stitely', 'bevstitely@saunderstax.com', '+13017142071',
   '2026 interest: Silver Sponsor ($2,500). Wants a book table (free or selling) matched with other sponsor tables, branded water bottles for the day, and is interested in the monthly program. President. Submitted Apr 27, 2026 (first: Jul 31, 2025).'),

  ('Humphrey''s Cleaning Service LLC', 'community',
   'At Humphrey''s Cleaning Service, we don''t just clean - we elevate your workplace. Our trained, reliable team tackles the messes others miss, creating healthier, safer environments for your employees and clients.',
   'https://www.humphreyclean.com',
   'William Humphrey', 'william@humphreyclean.com', null,
   '2026 interest: Community Sponsor ($750). Already bought his own ticket — the sponsorship ticket goes to Kevin Taylor, Director of Specialty Services. Chief Experience Officer. Submitted Sep 10, 2025.'),

  ('Wingman Executive Coaching', 'community',
   'Eric "Rabbit" Jorgensen is a former U.S. Air Force colonel and fighter pilot, who is now a leadership coach wingman certified by the International Coaching Federation, with a Doctor of Education degree specializing in human and organizational learning. Rabbit supports executives and others who are ready to propel their leadership performance and outcomes to new heights, empowered by a deep sense of gravity-defying purpose.',
   'https://wingmanexecutivecoaching.com',
   'Eric "Rabbit" Jorgensen', 'eric@wingmanexecutivecoaching.com', null,
   '2026 interest: Community Sponsor ($750). Founder / Executive Coach. Submitted Sep 8, 2025.'),

  ('Labers Office Furniture', 'community',
   'Mark and Kim Raidt – the owners since 2004 – have expanded the traditional operations of Labers to include contemporary office furniture, systems, supplies and countless other items needed at the office – all at heavily discounted prices. Labers is located at 1344 Wesel Boulevard in Hagerstown, just off Interstates 70 and 81.',
   'https://www.labersfurniture.com',
   'Kim Raidt', 'kim@labersfurniture.com', '+13019927878',
   '2026 interest: Community Sponsor ($750) — trade sponsorship for stools for the host to use during the day. COO. Submitted Sep 8, 2025.'),

  ('Edward Jones (Will Lawrence)', 'community',
   'Financial Planning and Wealth Management.',
   'https://www.edwardjones.com',
   'Will Lawrence', 'will.lawrence@edwardjones.com', null,
   '2026 interest: Community Sponsor ($750), split 4 ways. Financial Advisor. Submitted Sep 2, 2025.'),

  ('F&M Trust', 'community',
   '',
   'https://fmtrust.bank',
   'Diana Serna-Serrano', 'diana.serna-serrano@f-mtrust.com', null,
   '2026 interest: Community Sponsor. Looking at purchasing a couple of tickets; asked for proof of logo usage; company description to come. Marketing & Communications Manager. Submitted Aug 29, 2025.'),

  ('Martinsburg-Berkeley County Chamber of Commerce', 'community',
   'The Martinsburg-Berkeley County Chamber of Commerce is a dynamic organization dedicated to promoting economic growth, fostering connections, and supporting businesses of all sizes throughout the Eastern Panhandle. The Chamber offers networking opportunities, professional development, advocacy, and community engagement.',
   'https://www.berkeleycounty.org',
   'Kristie Hadley', 'kristie@berkeleycounty.org', '+13042674841',
   '2026 interest: Community Sponsor — prefers the sponsorship be in trade for marketing. President & CEO. Submitted Aug 29, 2025.'),

  ('SERVPRO of Washington County', 'community',
   'When disaster strikes, SERVPRO of Washington County strikes back fast. We provide 24/7 emergency mitigation, restoration, and cleanup services for water, fire, mold, and storm damage. From board-ups and tarping to full rebuilds, we protect and restore residential and commercial properties with speed and care.',
   'https://www.servprowashingtoncounty.com',
   'Donna Jean Digman', 'ddigman@servpro10664.com', '+14438650321',
   '2026 interest: Community Sponsor. Form filed under "SERVPRO of Baltimore''s Inner Harbor"; description and website are Washington County. Business Development Manager. Submitted Aug 28, 2025.'),

  ('CMG Home Loans (Joe Gillis)', 'community',
   'Joe Gillis — Your Home Loan Coach. CMG Home Loans — Every Customer, Every Time, No Exceptions, No Excuses.',
   'https://www.cmghomeloans.com/mysite/joe-gillis',
   'Joe Gillis', 'jgillis@cmghomeloans.com', '+13017884772',
   '2026 interest: Community Sponsorship ($750). Loan Officer. Submitted Aug 28, 2025.'),

  ('Middletown Valley Bank', 'lunch',
   'Since 1908, Middletown Valley Bank has been the cornerstone for our customers'' financial planning. Our exceptional customer service combined with state-of-the-art technology provides our customers with the best banking experience.',
   'https://mvbbank.com',
   'Matt South', 'msouth@mvbbank.com', null,
   '2026 interest: LUNCH Sponsor ($6,500). BJ Goetz, President & CEO, plans to speak on their behalf at the event. Contact: Matt South, Community Relations Officer. Submitted Aug 26, 2025.'),

  ('Martin''s Potato Rolls', 'community',
   'Martin''s is a family owned and operated consumer goods company focused on baking high-quality bread and roll products using high-quality ingredients — rigorously dedicated to extraordinary taste, quality, and customer service. Since the 1950s the business has grown from a home garage into two commercial baking plants.',
   'https://www.potatorolls.com',
   'Wendy Cowan', 'wcowan@potatorolls.com', null,
   '2026 interest: Community Sponsor. Will put a pack of Sweet Party Potato Rolls in the bags. Marketing Manager. Submitted Aug 11, 2025.'),

  ('GS Images', 'community',
   'GS Images is a sign company specializing in large format displays, vehicle lettering and wraps, banners, posters, decals of all sizes and shapes and many other graphic products.',
   'https://gsimages.com',
   'Doug Wright', 'dwright@gsimages.com', null,
   '2026 interest: Community Sponsor. President. Submitted Aug 4, 2025.'),

  ('Hagerstown Magazine', 'community_media',
   'Hagerstown Magazine is the area''s premiere lifestyle publication, featuring quality-of-life stories about dining, seniors, events, business and other positive content.',
   'https://www.hagerstownmagazine.com',
   'Chuck Boteler', 'cboteler@hagerstownmag.com', null,
   '2026 interest: Community Media Partner — in-kind value $1,465: half-page print ad, one eblast, one web banner, one social media feature post. Business Development Specialist. Submitted Jul 31, 2025.'),

  ('Sterling Settlement Services', 'community',
   'Sterling Settlement Services is a leading settlement company, renowned for its exceptional handling of transactions across the four-state area. Our reputation is built on a foundation of trust, efficiency, and a commitment to providing unparalleled service to our clients.',
   'https://www.sterlingsettle.com',
   'Michelle Compton', 'michelle@sterlingsettle.com', null,
   '2026 interest: Community Sponsor. Owner. Submitted Jul 31, 2025.'),

  ('River Bottom Roasters', 'coffee_break',
   'River Bottom Roasters cares about quality ingredients, ethical sourcing, fairness in trade and giving back to our communities. We don''t just want to make super delicious coffee, we want to make a difference in our local and international communities.',
   null,
   'V. Craig Campbell', 'riverbottomroasters@gmail.com', '+13015739070',
   '2026 interest: Coffee Break Sponsor. NOTE: exclusive package — RM Benefits asked for it too. Owner. Submitted Jul 30, 2025.'),

  ('Barley Snyder', 'platinum',
   'Barley Snyder is a strategically focused law firm representing businesses, organizations and individuals in all major areas of civil law. With offices throughout Pennsylvania and Maryland, the firm''s more than 130 attorneys provide innovative and effective representation to a wide range of clients.',
   'https://www.barley.com',
   'Jennifer Mowen', 'jmowen@barley.com', null,
   '2026 interest: Platinum Sponsor ($7,500). Attorney Paul Minnich is personally contributing to cover the cost of the sponsorship. Marketing Manager. Submitted Jul 28, 2025.'),

  ('D.L. Martin Company', 'community',
   'Our people are passionate about our purpose and values. We are sought after and valued by our customers. We are a place where people want to work — a culture of safety, innovation, opportunity and growth with advanced technology and tools.',
   'https://www.dlmartin.com',
   'Preston Spahr', 'pspahr@dlmartin.com', null,
   '2026 interest: Community ($750), in support of Eric Murr. Chairman of the Board. Submitted Jul 25, 2025.'),

  ('Shippensburg Area Chamber of Commerce', 'community',
   'The Shippensburg Area Chamber of Commerce is dedicated to supporting local businesses and fostering community growth. We provide networking opportunities, advocacy, and resources to help businesses thrive while promoting Shippensburg as a great place to live, work, and visit.',
   'https://shippensburg.org',
   'Wendy Kipe', 'director@shippensburg.org', null,
   '2026 interest: in-kind promotion (Chamber website feature, Tuesday e-newsletter, flyer in the printed Chamberline) — a Community Media Partner candidate. President. Submitted Jul 25, 2025.'),

  ('Washington County Chamber of Commerce', 'community',
   'Growth. Community. Success. Established in 1919, the mission of the Chamber is to foster and maintain a thriving business climate in which its members and community can grow and prosper. Members include more than 670 organizations representing over 40,000 local jobs across a wide variety of industries.',
   'https://www.hagerstown.org',
   'Maddie Monica', 'maddie@hagerstown.org', null,
   '2026 interest: Community Sponsor — trade for 5 Chamber eCasts. Marketing & Events. Submitted Jul 23, 2025.'),

  ('Hancock Media', 'community',
   'Hancock Media is a creative studio offering branding, website, print, and social content design and management — Design to Make a Difference. We help businesses grow through strategic, purpose-driven design while staying rooted in community impact.',
   'https://www.mhancockmedia.com',
   'Meredith Hancock', 'meredith@mhancockmedia.com', null,
   '2026 interest: package unclear on the form. Creative studio — possible Media Partner. Owner. Submitted Jul 9, 2025.'),

  ('Top of Virginia Regional Chamber', 'community',
   'The Top of Virginia Regional Chamber is the champion of more than 850 business members and their employees in Clarke County, Frederick County, and Winchester, Virginia — the premier business networking and advocacy organization in the region.',
   'https://www.regionalchamber.biz',
   'Cynthia Schneider', 'cschneider@regionalchamber.biz', '+15406644390',
   '2026 interest: Community — barter for TVRC marketing package valued $750 (dedicated email blast, Top of Mind ads, half-page newsletter ad). CEO. Submitted Jul 9, 2025.'),

  ('Work Smarter Digital', 'momentum_plus',
   'Work Smarter Digital helps service-based businesses double their revenue without sacrificing the personal, relationship-based sales that define their success. Our Revenue Accelerator System provides teams with automated, scalable sales pipelines, intelligent CRM, and strategic follow-ups that enhance consultative selling rather than replace it.',
   'https://www.worksmarterdigital.com',
   'Mary Sue Dahill', 'marysue@worksmarterdigital.com', null,
   '2026 interest: Momentum+ Sponsor ($10,000) — requested 3 payments, 50% in trade. CEO. Submitted Jun 30, 2025.')
),

-- New businesses land as hidden prospects. No term, no rail, no emails.
ins as (
  insert into public.sponsors
    (name, tier, description, website, rail_active, expires_at, prospect,
     contact_name, contact_email, contact_phone, notes)
  select v.name, v.tier, nullif(v.description, ''), v.website, false, null, true,
         v.contact_name, v.contact_email, v.contact_phone, v.notes
  from v
  where not exists (
    select 1 from public.sponsors s where lower(s.name) = lower(v.name)
  )
  returning 1
)

-- Businesses already in the table (2025 roster re-submitting for 2026) keep
-- their tier/description/status; they just get the 2026 interest note and
-- any missing contact info. The statement snapshot predates ins, so rows
-- inserted above are not touched; rows that already carry a 2026 note are
-- skipped, which makes re-runs no-ops.
update public.sponsors s
set contact_name  = coalesce(s.contact_name,  v.contact_name),
    contact_email = coalesce(s.contact_email, v.contact_email),
    contact_phone = coalesce(s.contact_phone, v.contact_phone),
    notes = case
      when coalesce(s.notes, '') = '' then v.notes
      else s.notes || E'\n' || v.notes
    end
from v
where lower(s.name) = lower(v.name)
  and position('2026 interest' in coalesce(s.notes, '')) = 0;
