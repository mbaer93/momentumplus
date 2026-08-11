/*
 * The Momentum+ Leadership Advisor Agreement.
 *
 * The text below is Sierra's, transcribed VERBATIM from the draft she sent
 * on 2026-08-10. It is legal wording: do not reword, condense, re-order, or
 * "tidy" any of it. Fixing a typo is still an edit — see AGREEMENT_VERSION.
 *
 * Structure only (headings, bullets, bold) is expressed as data so the page
 * can render it; every string is exactly what the document says.
 *
 * The blanks in the document — Leadership Advisor, Organization, Email,
 * Phone, Effective Date, Featured Month, Anticipated Featured Session Date,
 * Anticipated Featured Session Time, and the signature block — are NOT in
 * this file. They are form fields, rendered by the signing page and stored
 * per-signature in advisor_agreements (migration 0083).
 */

export type AgreementBlock =
  | { kind: "p"; text: string }
  /** A paragraph the document sets in bold. */
  | { kind: "strong"; text: string }
  /** A sub-heading inside a numbered section (§13 has four). */
  | { kind: "sub"; text: string }
  | { kind: "ul"; items: string[] };

export interface AgreementSection {
  n: number;
  title: string;
  blocks: AgreementBlock[];
}

/**
 * Which wording this is. Bumping it re-gates every Advisor: a signature is
 * only current for the version it was made against, and §32 requires
 * material amendments to be agreed by both parties. Do not bump it for a
 * rendering change that leaves the words alone — and do bump it for a typo
 * fix, because the words are what was agreed to.
 */
export const AGREEMENT_VERSION = "2026-08-10";

export const AGREEMENT_TITLE = "Momentum+ Leadership Advisor Agreement";

/** The paragraph above the party blanks. */
export const AGREEMENT_PREAMBLE =
  "This Momentum+ Leadership Advisor Agreement (“Agreement”) is entered into between Sierra Learnership Collaborative, LLC, host organization of the Tri-State Leadership Summit and Momentum+ (“SLC” or “Organizer”), and:";

/** The line above the signature blocks (§34). */
export const AGREEMENT_ACCEPTANCE =
  "By signing below, the parties acknowledge that they have reviewed, understood, and agreed to the terms of this Agreement.";

export const AGREEMENT_SECTIONS: AgreementSection[] = [
  {
    n: 1,
    title: "Purpose",
    blocks: [
      {
        kind: "p",
        text: "Momentum+ is the year-round leadership development and implementation ecosystem connected to the Tri-State Leadership Summit (“TSLS”).",
      },
      {
        kind: "p",
        text: "Momentum+ is designed to help leaders move beyond inspiration into implementation through practical education, accountability, focused execution, continued leadership development, and community connection.",
      },
      {
        kind: "p",
        text: "Momentum+ Leadership Advisors are selected professionals invited to contribute their expertise as trusted resources within this ecosystem.",
      },
      {
        kind: "p",
        text: "The role is intentionally different from a traditional keynote or featured Summit speaker role. Leadership Advisors contribute to the broader implementation and continuity experience throughout the year.",
      },
    ],
  },
  {
    n: 2,
    title: "Term",
    blocks: [
      {
        kind: "p",
        text: "This Agreement applies to the Advisor’s participation in the 2026–2027 Momentum+ Leadership Advisor cycle, including involvement with the 2026 Tri-State Leadership Summit and the Advisor’s designated featured Momentum+ session.",
      },
      {
        kind: "p",
        text: "The featured month and session date may be adjusted by mutual agreement or by SLC as reasonably necessary for program scheduling.",
      },
    ],
  },
  {
    n: 3,
    title: "Tri-State Leadership Summit Participation",
    blocks: [
      { kind: "p", text: "The 2026 Tri-State Leadership Summit will take place on:" },
      { kind: "strong", text: "Wednesday, October 14, 2026" },
      { kind: "strong", text: "The Maryland Theatre" },
      { kind: "p", text: "Hagerstown, Maryland" },
      {
        kind: "p",
        text: "Leadership Advisors may participate as panelists during a moderated Momentum+ Leadership Advisor discussion at the Summit.",
      },
      { kind: "p", text: "The purpose of the panel is to:" },
      {
        kind: "ul",
        items: [
          "Introduce the Leadership Advisors to Summit attendees",
          "Give Advisors an opportunity to share expertise and perspective",
          "Create awareness of the year-round Momentum+ experience",
          "Provide attendees with a preview of the education and resources available through Momentum+",
          "Build meaningful connections between Advisors and attendees",
        ],
      },
      {
        kind: "p",
        text: "SLC intends to provide panel questions or general discussion themes in advance whenever reasonably possible.",
      },
      {
        kind: "p",
        text: "If an Advisor is unable to participate in the Summit panel due to a previously identified scheduling conflict or other approved circumstance, that absence does not automatically disqualify the Advisor from participating in Momentum+.",
      },
    ],
  },
  {
    n: 4,
    title: "Complimentary Summit Admission",
    blocks: [
      {
        kind: "p",
        text: "The Advisor will receive one complimentary VIP Leadership Experience ticket to the 2026 Tri-State Leadership Summit.",
      },
      {
        kind: "p",
        text: "This ticket is provided so the Advisor may participate in the Summit, experience the event, engage with attendees, and take part in the broader TSLS leadership ecosystem.",
      },
    ],
  },
  {
    n: 5,
    title: "Complimentary Momentum+ Access",
    blocks: [
      {
        kind: "p",
        text: "The Advisor will receive complimentary access to Momentum+ programming during the applicable 2026–2027 program cycle.",
      },
      { kind: "p", text: "This allows the Advisor to:" },
      {
        kind: "ul",
        items: [
          "Experience the broader Momentum+ ecosystem",
          "Attend other featured educational sessions",
          "Participate in community discussions",
          "Become familiar with other Leadership Advisors and featured experts",
          "Understand how their own session fits within the larger annual leadership journey",
        ],
      },
      {
        kind: "p",
        text: "Participation outside the Advisor’s required commitments is optional.",
      },
    ],
  },
  {
    n: 6,
    title: "Featured Momentum+ Session",
    blocks: [
      {
        kind: "p",
        text: "The Advisor agrees to lead one live virtual educational session of approximately 60 minutes during the Advisor’s designated featured month.",
      },
      {
        kind: "p",
        text: "The session will be delivered virtually through the platform designated by SLC.",
      },
      {
        kind: "p",
        text: "The session should provide practical, relevant, actionable education connected to the Advisor’s area of expertise.",
      },
      { kind: "p", text: "The session may include:" },
      {
        kind: "ul",
        items: [
          "Educational presentation",
          "Frameworks or tools",
          "Practical strategies",
          "Guided reflection",
          "Case examples",
          "Interactive discussion",
          "Audience questions and answers",
          "Implementation-focused next steps",
        ],
      },
      {
        kind: "p",
        text: "SLC may open the session, provide brief program context, acknowledge sponsors or partners, and facilitate Q&A or closing remarks.",
      },
    ],
  },
  {
    n: 7,
    title: "Educational Standard",
    blocks: [
      {
        kind: "p",
        text: "The featured session is intended to be educational, not promotional.",
      },
      { kind: "p", text: "The Advisor may:" },
      {
        kind: "ul",
        items: [
          "Identify their organization",
          "Reference their experience or professional background",
          "Discuss their work where relevant to the educational topic",
          "Share a website, email address, calendar link, QR code, or other reasonable contact information at the conclusion of the session",
        ],
      },
      { kind: "p", text: "The Advisor may not use the session primarily as:" },
      {
        kind: "ul",
        items: [
          "A sales presentation",
          "A product pitch",
          "A service demonstration designed primarily to close business",
          "An aggressive promotional webinar",
          "A solicitation opportunity",
        ],
      },
      {
        kind: "p",
        text: "The goal is for future business relationships to develop organically from the value provided through the educational experience.",
      },
      {
        kind: "p",
        text: "Participants who wish to continue a conversation with the Advisor may contact the Advisor directly after the session.",
      },
    ],
  },
  {
    n: 8,
    title: "Member Solicitation and Privacy",
    blocks: [
      {
        kind: "p",
        text: "The Advisor may build relationships with Momentum+ members through normal participation in the program.",
      },
      { kind: "p", text: "However, the Advisor may not:" },
      {
        kind: "ul",
        items: [
          "Download or export member lists for unrelated marketing purposes",
          "Add members to outside marketing lists without consent",
          "Send unsolicited promotional emails or messages to Momentum+ members",
          "Use private member information for unrelated solicitation",
          "Sell, distribute, or share member information",
          "Misuse access to the Momentum+ community platform",
        ],
      },
      {
        kind: "p",
        text: "If a member independently reaches out to the Advisor, the Advisor may communicate with and work with that person without restriction from SLC.",
      },
    ],
  },
  {
    n: 9,
    title: "Community Participation",
    blocks: [
      {
        kind: "p",
        text: "The Advisor may be included within the Momentum+ community platform as a visible leadership resource.",
      },
      { kind: "p", text: "This may include:" },
      {
        kind: "ul",
        items: [
          "Name",
          "Professional title",
          "Biography",
          "Organization",
          "Website",
          "Area of expertise",
          "Contact or resource link",
          "Featured-session information",
        ],
      },
      {
        kind: "p",
        text: "The Advisor may engage in the community throughout the year if desired.",
      },
      {
        kind: "p",
        text: "Community participation beyond the featured session is encouraged but not required.",
      },
      { kind: "p", text: "Optional participation may include:" },
      {
        kind: "ul",
        items: [
          "Answering member questions",
          "Sharing relevant resources",
          "Engaging in professional discussions",
          "Supporting other Advisors",
          "Participating in collaborative conversations",
          "Attending additional Momentum+ sessions",
        ],
      },
    ],
  },
  {
    n: 10,
    title: "Promotion",
    blocks: [
      {
        kind: "p",
        text: "SLC will promote the Advisor’s featured session through appropriate TSLS and Momentum+ channels.",
      },
      { kind: "p", text: "Promotion may include:" },
      {
        kind: "ul",
        items: [
          "Email marketing",
          "Social media",
          "Momentum+ community announcements",
          "Promotional graphics",
          "Website or calendar placement",
          "Session announcements",
          "Advisor profiles",
          "Other appropriate marketing channels",
        ],
      },
      {
        kind: "p",
        text: "Leadership Advisors are strongly encouraged to promote Momentum+ and their featured session through their own professional networks.",
      },
      {
        kind: "p",
        text: "SLC may provide promotional graphics, suggested copy, links, or other marketing materials to support these efforts.",
      },
      {
        kind: "strong",
        text: "There is no required registration quota or minimum number of attendees the Advisor must personally generate.",
      },
      {
        kind: "p",
        text: "However, the Advisor acknowledges that increasing Momentum+ participation may increase:",
      },
      {
        kind: "ul",
        items: [
          "The audience exposed to the Advisor’s expertise",
          "The Advisor’s relationship-building opportunities",
          "The Advisor’s featured-month revenue-share compensation",
        ],
      },
    ],
  },
  {
    n: 11,
    title: "Optional Cross-Promotion and Collaboration",
    blocks: [
      {
        kind: "p",
        text: "Leadership Advisors are encouraged, but not required, to become familiar with the work of other Advisors and support the broader Momentum+ ecosystem.",
      },
      { kind: "p", text: "Optional collaboration may include:" },
      {
        kind: "ul",
        items: [
          "One-on-one conversations with fellow Advisors",
          "Cross-promotion of other sessions",
          "Collaborative educational discussions",
          "Periodic Advisor meetings",
          "Shared resources",
          "Referrals between Advisors",
          "Opportunities to connect expertise across different featured topics",
        ],
      },
      {
        kind: "p",
        text: "These activities are optional and are not required for continued participation.",
      },
    ],
  },
  {
    n: 12,
    title: "Podcast and Additional Promotional Opportunities",
    blocks: [
      {
        kind: "p",
        text: "SLC may invite the Advisor to participate in Branching Out with Sierra or other SLC/TSLS promotional opportunities.",
      },
      { kind: "p", text: "A podcast appearance may be used to:" },
      {
        kind: "ul",
        items: [
          "Introduce the Advisor",
          "Highlight the Advisor’s expertise",
          "Preview the featured Momentum+ session",
          "Increase visibility for the Advisor",
          "Promote Momentum+",
        ],
      },
      {
        kind: "p",
        text: "Podcast appearances and other additional promotional opportunities are not guaranteed unless separately confirmed in writing.",
      },
    ],
  },
  {
    n: 13,
    title: "Compensation",
    blocks: [
      {
        kind: "p",
        text: "In place of a traditional speaking honorarium, the Advisor will participate in the Momentum+ shared-growth revenue model.",
      },
      { kind: "p", text: "The Advisor will receive:" },
      {
        kind: "strong",
        text: "Fifteen percent (15%) of Momentum+ membership revenue attributable to active paid Momentum+ memberships during the month in which the Advisor’s featured session occurs.",
      },
      { kind: "sub", text: "Active Membership Definition" },
      {
        kind: "p",
        text: "An active membership is a paid Momentum+ membership that is active during the Advisor’s featured month.",
      },
      {
        kind: "p",
        text: "The membership may have originated before or during the Advisor’s month.",
      },
      { kind: "sub", text: "Multi-Month Commitments" },
      {
        kind: "p",
        text: "Momentum+ may be purchased in prepaid commitment periods, including:",
      },
      { kind: "ul", items: ["1 month", "3 months", "6 months", "12 months"] },
      {
        kind: "p",
        text: "For purposes of calculating the Advisor’s revenue share, prepaid membership revenue will be allocated across the applicable commitment period using the member’s actual effective monthly rate.",
      },
      {
        kind: "p",
        text: "For example, if a member purchases a 12-month Momentum+ commitment for $1,668, the membership is valued at $139 per active month for Advisor-compensation purposes.",
      },
      {
        kind: "p",
        text: "The full $1,668 is not treated as revenue attributable solely to the month in which the membership was purchased.",
      },
      { kind: "sub", text: "Discounted Memberships" },
      {
        kind: "p",
        text: "If a Momentum+ membership is sold at a discount or promotional rate, Advisor compensation will be calculated using the actual amount paid by the member, allocated across the applicable membership period.",
      },
      {
        kind: "p",
        text: "The calculation will not be based on the undiscounted retail value.",
      },
      { kind: "sub", text: "Excluded Revenue" },
      {
        kind: "p",
        text: "The Advisor revenue share applies only to Momentum+ membership revenue.",
      },
      { kind: "p", text: "It does not include:" },
      {
        kind: "ul",
        items: [
          "General Admission ticket revenue",
          "VIP Leadership Experience revenue",
          "Sponsorship revenue",
          "Mid-Year Summit standalone ticket revenue",
          "Other SLC programs or services",
          "Complimentary memberships",
          "Taxes",
          "Refunds",
          "Chargebacks",
          "Barter or in-kind arrangements",
        ],
      },
    ],
  },
  {
    n: 14,
    title: "Shared Advisor Sessions",
    blocks: [
      {
        kind: "p",
        text: "If two Leadership Advisors jointly lead the same featured session, the standard Advisor allocation remains 15% total for that featured month.",
      },
      { kind: "p", text: "The two Advisors will share that 15% allocation." },
      {
        kind: "p",
        text: "The distribution between the two Advisors may be determined by:",
      },
      {
        kind: "ul",
        items: [
          "Equal division, or",
          "Another written arrangement mutually agreed upon by the participating Advisors and SLC",
        ],
      },
      {
        kind: "p",
        text: "If no alternative written arrangement is established, the 15% allocation will be divided equally.",
      },
    ],
  },
  {
    n: 15,
    title: "Payment",
    blocks: [
      {
        kind: "p",
        text: "The Momentum+ platform will calculate the Advisor’s featured-month revenue-share amount based on active membership revenue attributable to that month.",
      },
      {
        kind: "strong",
        text: "Payment will be issued within thirty (30) days following the conclusion of the Advisor’s featured month.",
      },
      { kind: "p", text: "The Advisor acknowledges that SLC does not guarantee:" },
      {
        kind: "ul",
        items: [
          "A minimum number of Momentum+ members",
          "A minimum revenue amount",
          "A minimum compensation amount",
          "A minimum number of attendees at the featured session",
        ],
      },
      {
        kind: "p",
        text: "The shared-growth model is intended to align the success of the Advisor with the continued growth of Momentum+.",
      },
    ],
  },
  {
    n: 16,
    title: "No Continuing Commission",
    blocks: [
      {
        kind: "p",
        text: "The Advisor’s revenue share applies only to the month in which the Advisor delivers their featured session.",
      },
      { kind: "p", text: "The Advisor does not receive:" },
      {
        kind: "ul",
        items: [
          "Ongoing commissions",
          "Residual commissions",
          "Renewal commissions",
          "Affiliate commissions",
          "Compensation for members after the featured month",
        ],
      },
      {
        kind: "p",
        text: "unless a separate written agreement specifically provides otherwise.",
      },
    ],
  },
  {
    n: 17,
    title: "Rescheduling and Compensation",
    blocks: [
      {
        kind: "p",
        text: "If the Advisor cannot deliver the featured session due to illness, emergency, unavoidable scheduling conflict, or other approved circumstance, SLC and the Advisor will make reasonable efforts to reschedule the session.",
      },
      { kind: "p", text: "If the session is moved to another month:" },
      {
        kind: "strong",
        text: "The Advisor’s 15% revenue share will apply to the new month in which the session actually occurs.",
      },
      {
        kind: "p",
        text: "The compensation does not remain attached to the originally scheduled month.",
      },
      {
        kind: "p",
        text: "SLC may also adjust the annual Momentum+ calendar when reasonably necessary to preserve program flow or respond to scheduling needs.",
      },
    ],
  },
  {
    n: 18,
    title: "Recording",
    blocks: [
      {
        kind: "p",
        text: "The Advisor agrees that the featured Momentum+ session may be recorded.",
      },
      {
        kind: "p",
        text: "SLC may retain, host, replay, distribute, excerpt, and use the recording within the Momentum+ and TSLS ecosystem.",
      },
      { kind: "p", text: "Possible uses include:" },
      {
        kind: "ul",
        items: [
          "Momentum+ replay access",
          "Member education",
          "Promotional clips",
          "Social media",
          "Future marketing",
          "Internal archives",
          "TSLS and SLC educational content",
        ],
      },
    ],
  },
  {
    n: 19,
    title: "Advisor Recording Rights",
    blocks: [
      {
        kind: "p",
        text: "The Advisor may also receive and use the recording of their own featured session.",
      },
      { kind: "p", text: "The Advisor may use the recording for purposes including:" },
      {
        kind: "ul",
        items: [
          "Marketing",
          "Training",
          "Social media",
          "Website content",
          "Portfolio materials",
          "Future educational programs",
          "Professional development",
          "Other business purposes",
        ],
      },
      {
        kind: "p",
        text: "SLC does not claim exclusive ownership over the Advisor’s underlying educational content.",
      },
    ],
  },
  {
    n: 20,
    title: "Intellectual Property",
    blocks: [
      { kind: "p", text: "The Advisor retains ownership of their pre-existing:" },
      {
        kind: "ul",
        items: [
          "Frameworks",
          "Models",
          "Educational concepts",
          "Presentation materials",
          "Original written content",
          "Proprietary tools",
          "Intellectual property",
        ],
      },
      {
        kind: "p",
        text: "SLC retains rights to recordings produced by or on behalf of SLC in connection with Momentum+ or TSLS.",
      },
      {
        kind: "p",
        text: "Both parties may use the recorded featured session as described in this Agreement.",
      },
      {
        kind: "p",
        text: "Nothing in this Agreement transfers ownership of the Advisor’s underlying intellectual property to SLC.",
      },
    ],
  },
  {
    n: 21,
    title: "Promotional Rights",
    blocks: [
      { kind: "p", text: "The Advisor grants SLC permission to use the Advisor’s:" },
      {
        kind: "ul",
        items: [
          "Name",
          "Professional title",
          "Biography",
          "Headshot",
          "Organization name",
          "Logo",
          "Website",
          "Social media handles",
          "Session title",
          "Session description",
          "Approved promotional information",
        ],
      },
      {
        kind: "p",
        text: "for purposes related to promoting TSLS, Momentum+, the Advisor’s participation, and the broader leadership ecosystem.",
      },
    ],
  },
  {
    n: 22,
    title: "Advisor Materials",
    blocks: [
      {
        kind: "p",
        text: "The Advisor agrees to provide reasonable promotional and session materials requested by SLC.",
      },
      { kind: "p", text: "These may include:" },
      {
        kind: "ul",
        items: [
          "Professional headshot",
          "Biography",
          "Organization logo",
          "Website link",
          "Session title",
          "Session description",
          "Participant takeaways",
          "Presentation slides",
          "Worksheets",
          "Supplemental resources",
          "Social media handles",
          "Contact information",
        ],
      },
      {
        kind: "p",
        text: "The Advisor agrees to provide requested materials by deadlines reasonably established by SLC.",
      },
    ],
  },
  {
    n: 23,
    title: "Technology and Session Preparation",
    blocks: [
      { kind: "p", text: "The Advisor agrees to:" },
      {
        kind: "ul",
        items: [
          "Deliver the session virtually through the platform selected by SLC",
          "Have reliable internet access",
          "Use professional-quality audio and video when reasonably possible",
          "Join the session early if requested for technology checks",
          "Provide presentation materials by the requested deadline",
          "Promptly communicate technical or scheduling concerns",
        ],
      },
    ],
  },
  {
    n: 24,
    title: "Professional Conduct",
    blocks: [
      {
        kind: "p",
        text: "The Advisor agrees to maintain professional conduct throughout all Summit, Momentum+, community, and related activities.",
      },
      { kind: "p", text: "The Advisor agrees to avoid:" },
      {
        kind: "ul",
        items: [
          "Profanity or explicit content inappropriate for the audience",
          "Partisan political advocacy",
          "Discriminatory, defamatory, or demeaning statements",
          "Harassment",
          "Aggressive solicitation",
          "Conduct reasonably likely to materially damage the reputation of SLC, TSLS, Momentum+, fellow Advisors, sponsors, or participants",
        ],
      },
      {
        kind: "p",
        text: "SLC may remove or terminate participation for material violations of these standards.",
      },
    ],
  },
  {
    n: 25,
    title: "Confidentiality",
    blocks: [
      {
        kind: "p",
        text: "The Advisor may receive non-public information related to:",
      },
      {
        kind: "ul",
        items: [
          "Momentum+ strategy",
          "Membership numbers",
          "Revenue information",
          "Pricing",
          "Internal planning",
          "Future programming",
          "Sponsors",
          "Members",
          "Marketing strategy",
          "Business operations",
        ],
      },
      {
        kind: "p",
        text: "The Advisor agrees to maintain the confidentiality of non-public business information unless disclosure is authorized by SLC or legally required.",
      },
    ],
  },
  {
    n: 26,
    title: "Independent Contractor Relationship",
    blocks: [
      { kind: "p", text: "The Advisor participates as an independent contractor." },
      { kind: "p", text: "Nothing in this Agreement establishes an:" },
      {
        kind: "ul",
        items: [
          "Employment relationship",
          "Partnership",
          "Joint venture",
          "Agency relationship",
          "Franchise",
          "Fiduciary relationship",
        ],
      },
      {
        kind: "p",
        text: "The Advisor is responsible for any applicable taxes or reporting obligations associated with compensation received.",
      },
      {
        kind: "p",
        text: "The Advisor may not bind SLC contractually or financially.",
      },
    ],
  },
  {
    n: 27,
    title: "Non-Exclusivity",
    blocks: [
      {
        kind: "p",
        text: "Participation as a Momentum+ Leadership Advisor is non-exclusive.",
      },
      { kind: "p", text: "The Advisor may participate in other:" },
      {
        kind: "ul",
        items: [
          "Speaking engagements",
          "Membership programs",
          "Coaching programs",
          "Consulting engagements",
          "Events",
          "Professional communities",
        ],
      },
      {
        kind: "p",
        text: "The Advisor may not represent themselves as having exclusive authority to act on behalf of SLC, TSLS, or Momentum+.",
      },
    ],
  },
  {
    n: 28,
    title: "Cancellation or Termination",
    blocks: [
      {
        kind: "p",
        text: "Either party may terminate this Agreement upon written notice if continued participation becomes impractical.",
      },
      { kind: "p", text: "SLC may terminate participation immediately for:" },
      {
        kind: "ul",
        items: [
          "Material breach of this Agreement",
          "Failure to deliver the agreed session without reasonable cause",
          "Repeated failure to communicate",
          "Improper use of member information",
          "Aggressive solicitation",
          "Serious professional-conduct violations",
          "Misrepresentation of the Advisor’s relationship with SLC",
          "Conduct reasonably likely to materially harm the program",
        ],
      },
      {
        kind: "p",
        text: "If the Agreement is terminated before the Advisor delivers the featured session, no featured-month revenue share is owed unless otherwise agreed in writing.",
      },
    ],
  },
  {
    n: 29,
    title: "Changes to Program Structure",
    blocks: [
      { kind: "p", text: "Momentum+ is an evolving leadership ecosystem." },
      { kind: "p", text: "SLC may make reasonable adjustments to:" },
      {
        kind: "ul",
        items: [
          "Session timing",
          "Calendar sequencing",
          "Platform technology",
          "Community structure",
          "Program logistics",
          "Promotional processes",
          "Session format",
        ],
      },
      {
        kind: "p",
        text: "Material changes affecting the Advisor’s compensation or core obligations will be communicated in writing.",
      },
    ],
  },
  {
    n: 30,
    title: "No Guarantee of Business Results",
    blocks: [
      { kind: "p", text: "Participation may provide:" },
      {
        kind: "ul",
        items: [
          "Visibility",
          "Exposure",
          "Relationship-building opportunities",
          "Educational authority",
          "Potential client connections",
          "Revenue-share compensation",
        ],
      },
      { kind: "p", text: "However, SLC does not guarantee:" },
      {
        kind: "ul",
        items: [
          "Leads",
          "Clients",
          "Contracts",
          "Sales",
          "Speaking opportunities",
          "Referrals",
          "Specific membership numbers",
          "Specific financial results",
        ],
      },
    ],
  },
  {
    n: 31,
    title: "Entire Agreement",
    blocks: [
      {
        kind: "p",
        text: "This Agreement represents the understanding between SLC and the Advisor regarding participation in the Momentum+ Leadership Advisor program.",
      },
      {
        kind: "p",
        text: "It supersedes prior informal discussions regarding the specific terms addressed herein while remaining consistent with the general program vision previously presented to the Leadership Advisors.",
      },
      {
        kind: "p",
        text: "Any separate written agreement between the parties remains enforceable according to its own terms unless specifically superseded.",
      },
    ],
  },
  {
    n: 32,
    title: "Amendment",
    blocks: [
      {
        kind: "p",
        text: "Material amendments to this Agreement must be made in writing and agreed upon by both parties.",
      },
      {
        kind: "p",
        text: "Routine scheduling and logistical changes may be confirmed through email.",
      },
    ],
  },
  {
    n: 33,
    title: "Governing Law",
    blocks: [
      {
        kind: "p",
        text: "This Agreement will be governed by the laws of the Commonwealth of Virginia unless otherwise required by applicable law.",
      },
    ],
  },
];

/**
 * The agreement as one canonical string — the exact bytes that get hashed
 * into advisor_agreements.agreement_sha256.
 *
 * Stable by construction: it walks the same data the page renders, so any
 * change to the wording changes the hash, and a change to fonts, spacing or
 * layout does not. Bullets are prefixed so that moving a line between a
 * paragraph and a list still moves the hash.
 */
export function canonicalAgreementText(): string {
  const lines: string[] = [AGREEMENT_TITLE, AGREEMENT_PREAMBLE];
  for (const section of AGREEMENT_SECTIONS) {
    lines.push(`${section.n}. ${section.title}`);
    for (const block of section.blocks) {
      switch (block.kind) {
        case "p":
        case "strong":
        case "sub":
          lines.push(`${block.kind}:${block.text}`);
          break;
        case "ul":
          for (const item of block.items) lines.push(`li:${item}`);
          break;
      }
    }
  }
  lines.push(`34. Acceptance`);
  lines.push(`p:${AGREEMENT_ACCEPTANCE}`);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------
 * Who has to sign, and whether their signature is still current
 * ---------------------------------------------------------------------- */

export interface AgreementGateSpeaker {
  /** TSLS mainstage speakers are not Leadership Advisors — §1 makes the two
      roles explicitly different, so this agreement is not theirs to sign. */
  tslsMainSpeaker: boolean;
  /** Admin escape hatch (migration 0083): signed on paper, or not an
      Advisor at all. */
  advisorAgreementWaived: boolean;
}

export interface SignedAgreement {
  agreementVersion: string;
  signedName: string;
  signedAt: string;
}

/** Does this speaker have to sign before Speaker Studio opens? */
export function agreementRequired(speaker: AgreementGateSpeaker): boolean {
  return !speaker.tslsMainSpeaker && !speaker.advisorAgreementWaived;
}

/**
 * Is an existing signature good for the wording currently on file? A
 * signature made against an older version does not carry forward — §32
 * needs both parties to agree to a material amendment, and the platform
 * cannot tell a material change from a cosmetic one.
 */
export function agreementIsCurrent(signed: SignedAgreement | null): boolean {
  return signed?.agreementVersion === AGREEMENT_VERSION;
}

/** The one question the Studio asks: let this speaker in, or send them to sign? */
export function mustSignBeforeStudio(
  speaker: AgreementGateSpeaker,
  signed: SignedAgreement | null,
): boolean {
  return agreementRequired(speaker) && !agreementIsCurrent(signed);
}
