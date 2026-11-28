/*
 * Privacy policy, Terms of use and Refund policy: the one source for the /privacy, /terms and
 * /refunds pages (LegalPage.tsx) and for the copy sent for legal review (scripts/legal-md.mjs).
 *
 * BEFORE PUBLISHING: fill every [TO FILL …] / [TO CONFIRM …] (most are in CO below), have an
 * Indian advocate review the text, and bump UPDATED. The pages highlight anything still unfilled.
 *
 * Inline markup in the strings: **bold** and [link text](/path or mailto:…).
 */

/** The business details used throughout. Fill these once. */
export const CO = {
  brand: "Senevon Game Studio",
  legalName: "[TO FILL: registered legal name, e.g. Senevon … Private Limited]",
  entity: "[TO FILL: company / LLP / proprietorship, with CIN / LLPIN, and GSTIN if registered]",
  address: "[TO FILL: registered office address]",
  site: "games.senevon.in",
  app: "Senevon Games (Android app, com.senevon.games)",
  email: "[TO FILL: support email]",
  privacyEmail: "[TO FILL: privacy / data-rights email]",
  grievanceName: "[TO FILL: Grievance Officer's name]",
  grievanceEmail: "[TO FILL: Grievance Officer's email]",
  grievancePhone: "[TO FILL: Grievance Officer's phone (optional)]",
  courtsCity: "[TO FILL: city of the registered office]",
  dataRegion: "[TO CONFIRM: region of the Supabase project, e.g. Mumbai (ap-south-1)]",
  hosting: "[TO CONFIRM: website host, e.g. Vercel / Netlify / Cloudflare]",
};

export const UPDATED = "[TO FILL: date of publishing]";

export type Block = string | { list: string[] };
export type Section = { id: string; h: string; blocks: Block[] };
export type LegalDoc = { slug: "privacy" | "terms" | "refunds"; title: string; intro: Block[]; sections: Section[] };

const WHO = `${CO.brand} is operated by ${CO.legalName}, ${CO.entity}, having its registered office at ${CO.address} ("**${CO.brand}**", "**we**", "**us**", "**our**")`;

const GRIEVANCE: Block[] = [
  "In line with the Information Technology Act, 2000, the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and the Digital Personal Data Protection Act, 2023, our Grievance Officer is:",
  {
    list: [
      `**Name:** ${CO.grievanceName}`,
      `**Email:** ${CO.grievanceEmail}`,
      `**Phone:** ${CO.grievancePhone}`,
      `**Address:** ${CO.address}`,
    ],
  },
  "Please include your account email or player name and enough detail for us to find the issue. We acknowledge complaints within **24 hours** and aim to resolve them within **15 days** of receipt. Requests to remove content that exposes a person's private area, shows them in sexual content or impersonates them are acted on within 24 hours.",
];

/* ============================================================
   Privacy policy
   ============================================================ */
export const PRIVACY: LegalDoc = {
  slug: "privacy",
  title: "Privacy policy",
  intro: [
    `${WHO}. We run the website ${CO.site} and the app ${CO.app} (together, the "**Service**"), where you can play casual games for free, alone, against our computer opponent Senevi, or online with other players.`,
    "This policy explains what personal data we collect, why, who we share it with, how long we keep it and the rights you have. It is our notice under the Digital Personal Data Protection Act, 2023 (\"**DPDP Act**\") and the rules made under it, and our privacy policy under the Information Technology Act, 2000 and the rules made under it. For your personal data we are the \"Data Fiduciary\" and you are the \"Data Principal\".",
    "In short: you can play as a guest without giving us anything. If you create an account we keep what is needed to run it. We do not sell your personal data.",
  ],
  sections: [
    {
      id: "guest",
      h: "1. Playing as a guest",
      blocks: [
        "Every game can be played without an account. Guest scores, settings, recently played games and favourites are stored only on your own device (browser storage or app storage). We still receive the anonymous usage statistics described in section 2(h) and the technical data in section 2(j).",
      ],
    },
    {
      id: "collect",
      h: "2. What we collect and why",
      blocks: [
        "**(a) Your account.** Your email address, or, if you sign in with Google, the name, email address and profile photo Google shares with us. Passwords and sign-in are handled by our authentication provider (Supabase); we never see your Google password. We also log when you sign in and with which method. *Purpose:* to create your account, sign you in and keep it secure.",
        "**(b) Your profile.** Your display name, your avatar (a library avatar or your Google photo), the avatar frame you equip and your public stats. *Purpose:* to show you on leaderboards, in matches, in clubs and to friends.",
        "**(c) Gameplay.** Scores, play times, game results, levels and experience points, achievements, saved progress, online match results and room codes, favourite games, items you own and equip, and drawings you share in Draw a Tune. *Purpose:* to save your progress, run leaderboards, competitions and matchmaking, and settle online matches fairly.",
        "**(d) Friends and chat.** Who you follow, friend requests, friends, players you block, and messages you send to friends. Chat uses only ready-made message and sticker packs (no free typing); we keep the last 100 messages between two friends. *Purpose:* to provide the social features and keep them safe.",
        "**(e) Clubs.** Clubs you create or join, your role, club name and description, invites, bans, and chips you put into or receive from a club wallet. *Purpose:* to run clubs and their shared wallet.",
        "**(f) Chips, rewards and purchases.** Your chip balance and a history of every chip added or spent (for example daily rewards, challenges, achievements, referrals, competition prizes, shop items, gifts, club wallet and match entries and prizes), your referral code and who joined with it, and your Plus or ad-free status. For purchases we keep the order and payment identifiers, item, amount, currency, status and date. **Card, UPI, bank and wallet details are collected by Razorpay or Google Play, not by us.** *Purpose:* to deliver what you earn or buy, prevent abuse and fraud, handle refunds and keep records required by tax and accounting law.",
        "**(g) Advertising.** The Service shows ads from Google (AdSense on the website, AdMob in the app). Google and its partners may use cookies, your device's advertising ID, IP address and similar data to show, limit and measure ads. When you watch a rewarded ad, we tell Google your account ID so the reward can be verified and credited to you. We record ad impressions and clicks for our own ads in our statistics (below). *Purpose:* to keep the games free.",
        "**(h) Usage statistics.** Page views, when a game is started or finished (with the score), ad impressions and clicks, a random visitor ID stored on your device, the type of device (mobile, tablet or desktop) and, on your first page, the website that linked you to us. These records do not include your name or email. *Purpose:* to learn which games and pages are used, fix problems and improve the Service.",
        "**(i) Messages to us.** If you contact us, report a problem or send a business enquiry, we keep your name, email, phone number (if given), organisation and message. *Purpose:* to reply and keep a record of the request.",
        "**(j) Technical data.** Our hosting, database and content-delivery providers process your IP address, browser or app version and device details to deliver the Service, keep it secure and keep logs. *Purpose:* security, fraud prevention and keeping the Service working.",
        "We do not collect your precise location, contacts, photos or files, and we do not ask for government ID numbers.",
      ],
    },
    {
      id: "basis",
      h: "3. Why we are allowed to use it",
      blocks: [
        "We process personal data on the basis of your **consent**, which you give by creating an account, signing in with Google, choosing to make a purchase or contact us, and through any consent prompts in the Service. You can withdraw consent at any time (section 10); this does not affect processing already done, but we may then be unable to provide the parts of the Service that need that data.",
        "We may also process personal data for the **legitimate uses** allowed by Section 7 of the DPDP Act, for example where you have voluntarily provided it for a specific purpose, to comply with law or a court order, or to respond to a medical emergency or threat to safety.",
      ],
    },
    {
      id: "public",
      h: "4. What other players can see",
      blocks: [
        "Your display name, avatar, frame, scores, ranks, levels, achievements, club membership, follower and friend counts and the drawings you share are visible to other players and, on leaderboards, to anyone visiting the Service. Your email address is never shown to other players. Please don't use your real full name as a display name if you don't want it public.",
      ],
    },
    {
      id: "share",
      h: "5. Who we share it with",
      blocks: [
        "We do not sell or rent personal data. We share it only with:",
        {
          list: [
            `**Service providers (Data Processors)** who work for us under contract: Supabase (database, sign-in and storage), ${CO.hosting} (website hosting), Google (Sign in with Google, Google Fonts, AdSense and AdMob), Razorpay (payments on the website) and Google Play (purchases in the app).`,
            "**Other players**, only as described in section 4.",
            "**Embedded games:** a few games are provided by other studios and shown inside our pages. While you play them, those studios may collect data under their own privacy policies.",
            "**Authorities**, when required by law, a court order or a lawful request from a government agency, or to protect the rights, property or safety of our players, the public or us.",
            "**A buyer or successor**, if our business is merged, acquired or transferred, under terms that protect your data at least as well as this policy.",
          ],
        },
      ],
    },
    {
      id: "ads",
      h: "6. Ads, cookies and device storage",
      blocks: [
        "On the website we and Google use cookies and browser storage. Google's use of advertising data is described at [policies.google.com/technologies/ads](https://policies.google.com/technologies/ads). You can turn off personalised ads at [adssettings.google.com](https://adssettings.google.com), and in the app you can reset or delete your advertising ID in your phone's settings (Settings → Google → Ads, or Settings → Privacy → Ads).",
        "**For players under 18 we do not allow personalised (behaviourally targeted) ads.** Ad requests for child accounts, and for guests where we do not know the player's age, are marked as child-directed so that Google shows only non-personalised ads.",
        "We use our own browser and app storage to keep you signed in, store guest scores and progress, recently played games, favourites, your avatar, theme and performance settings, and the anonymous visitor ID. You can clear it at any time in your browser or app settings; you will then be signed out and guest progress on that device will be lost.",
      ],
    },
    {
      id: "children",
      h: "7. Children",
      blocks: [
        "Under the DPDP Act anyone under 18 is a child. Children may play as guests. **A child may create an account only with the verifiable consent of a parent or lawful guardian**, which we ask for before the account is created. The parent or guardian accepts our Terms of use on the child's behalf and is responsible for the child's use of the Service, including any purchases.",
        "For child accounts we do not track or monitor behaviour for advertising, we do not show personalised ads, and we do not process data in a way likely to harm the child's well-being. A parent or guardian can ask us at any time to see, correct or delete their child's data, or withdraw consent, by writing to " +
          CO.privacyEmail +
          ". If we learn that a child's account was created without parental consent, we will delete it.",
      ],
    },
    {
      id: "retention",
      h: "8. How long we keep it",
      blocks: [
        {
          list: [
            "**Account, profile, gameplay, social and club data:** while your account exists. When you delete your account, we erase this data within 30 days, except as below.",
            "**Purchase, payment and chip records:** kept for as long as tax, accounting and other laws require (generally up to 8 years), then deleted.",
            "**Security and access logs:** kept for at least one year, as required by law, then deleted.",
            "**Friend messages:** the last 100 per pair of friends; older ones are deleted automatically.",
            "**Usage statistics:** [TO CONFIRM: e.g. up to 24 months], after which only totals without the visitor ID are kept.",
            "**Messages to us and business enquiries:** up to 3 years after the last contact.",
          ],
        },
        "Where the DPDP rules require us to erase the data of a user who has been inactive for a set period, we will tell you at least 48 hours before doing so, so that you can sign in to keep your account.",
      ],
    },
    {
      id: "security",
      h: "9. Security and where your data is stored",
      blocks: [
        "We use reasonable security safeguards: encrypted connections (HTTPS), access rules in our database so each player can read only what they are allowed to, limited staff access, and logging of access. No system is perfectly secure; if a personal data breach happens, we will inform affected users and the Data Protection Board of India as the law requires.",
        `Our database is hosted by Supabase in ${CO.dataRegion}. Some of our providers (such as Google) may process data outside India. We transfer personal data outside India only as permitted by the DPDP Act, and never to a country the Government of India has restricted.`,
      ],
    },
    {
      id: "rights",
      h: "10. Your rights",
      blocks: [
        "Under the DPDP Act you have the right to:",
        {
          list: [
            "**Access:** get a summary of the personal data we hold about you, what we do with it, and who we have shared it with.",
            "**Correction and erasure:** have inaccurate or incomplete data corrected, completed or updated, and have your data erased when it is no longer needed (subject to section 8).",
            "**Withdraw consent** as easily as you gave it.",
            "**Grievance redressal:** have complaints handled by our Grievance Officer (section 12).",
            "**Nominate** a person to exercise your rights if you die or become unable to.",
          ],
        },
        `You can change your display name and avatar in your profile, and delete your account [TO CONFIRM: in Profile → Delete account]. For anything else, write to ${CO.privacyEmail} from your account email. We may ask you to confirm your identity. We respond within 30 days at most.`,
        "If you are not satisfied with our response, you may complain to the **Data Protection Board of India** after using our grievance process.",
        "If you live outside India, you may have additional rights under your local law (for example, in the EU or UK). Write to us and we will help.",
      ],
    },
    {
      id: "duties",
      h: "11. Your duties",
      blocks: [
        "As the DPDP Act requires, please don't impersonate anyone, don't give us false information, don't suppress material information when you ask us to verify something, and don't file false or frivolous complaints.",
      ],
    },
    { id: "grievance", h: "12. Grievance Officer and contact", blocks: [...GRIEVANCE, `For general questions: ${CO.email}.`] },
    {
      id: "changes",
      h: "13. Changes to this policy",
      blocks: [
        "We may update this policy when the Service or the law changes. We will change the date at the top and, for important changes, tell you in the Service before they apply. Where the change needs your fresh consent, we will ask for it.",
      ],
    },
  ],
};

/* ============================================================
   Terms of use
   ============================================================ */
export const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms of use",
  intro: [
    `${WHO}. These Terms of use ("**Terms**") govern your use of the website ${CO.site}, the app ${CO.app} and every game and feature in them (the "**Service**").`,
    "By using the Service you agree to these Terms, our [Privacy policy](/privacy) and our [Refund policy](/refunds). If you do not agree, please do not use the Service.",
    "These Terms are an electronic record under the Information Technology Act, 2000 and the rules made under it, and are published in accordance with Rule 3(1) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021. They do not need a physical or digital signature.",
  ],
  sections: [
    {
      id: "eligibility",
      h: "1. Who can use the Service",
      blocks: [
        "Anyone may play as a guest. To create an account you must be at least 18, **or** have the consent of your parent or lawful guardian. If you are under 18, your parent or guardian accepts these Terms on your behalf and is responsible for your use of the Service, including any purchase. A child must not make a purchase without their parent's or guardian's permission.",
        "You must not use the Service if you have been banned from it, or if using it would break the law where you live.",
      ],
    },
    {
      id: "account",
      h: "2. Your account",
      blocks: [
        {
          list: [
            "One account per person. Give accurate information and keep it up to date.",
            "Keep your sign-in secure. You are responsible for what happens in your account; tell us at once if you think someone else is using it.",
            "Your display name, club names and anything else you choose must follow section 7. We may change or remove a name that doesn't.",
            "Accounts are personal. You may not sell, rent, share, transfer or buy an account.",
          ],
        },
      ],
    },
    {
      id: "service",
      h: "3. The Service",
      blocks: [
        "We grant you a personal, limited, non-exclusive, non-transferable, revocable licence to use the Service for your own entertainment, in line with these Terms.",
        "**Senevi** is our computer opponent: it is a program, not a human player. Some games are made by other studios and shown inside our pages; their own terms may also apply. Online play depends on your internet connection; a match may be ended or settled automatically if a player disconnects or leaves.",
        "We regularly add, change and remove games and features, and the Service may sometimes be unavailable for maintenance or for reasons outside our control. Features marked new, beta or early access may change or end.",
      ],
    },
    {
      id: "no-money",
      h: "4. No real-money gaming",
      blocks: [
        "The Service offers only free-to-play casual, skill and social games. It does **not** offer any online money game within the meaning of the Promotion and Regulation of Online Gaming Act, 2025, and it is not a gambling or betting service.",
        {
          list: [
            "**Chips, Table chips, experience points, levels, prizes and items have no monetary value.** They cannot be withdrawn, cashed out, redeemed for money, exchanged for anything outside the Service, or sold, traded or transferred for money or anything of value.",
            "No game asks you to deposit or stake money in the hope of winning money or anything of monetary value. Competition prizes, rewards and match prizes are paid only in chips or in-game items.",
            "Chip matches use only chips earned in the Service, never bought chips. Card games use free **Table chips**, which cannot be bought, cannot be converted into chips and have no use outside the card tables.",
            "Buying chips, Plus or an ad-free pass is a payment for access to digital content and features, not a stake, and never entitles you to winnings.",
            "Any attempt to buy, sell or trade chips, items or accounts for money, inside or outside the Service, is prohibited and will lead to the account being closed and its balance removed.",
          ],
        },
      ],
    },
    {
      id: "virtual",
      h: "5. Chips and other virtual items",
      blocks: [
        "Chips and items you earn or buy are a limited licence to use that content in the Service; you do not own them. We may change how chips and items work, their prices or what they can be used for, and we may correct balances changed by mistake, a bug or abuse.",
        "**Gifts and clubs.** You can give earned chips to friends and put earned chips into a club wallet, within the daily limits and account-age rules shown in the Service. Chips put into a club wallet belong to the club; the club owner decides how they are paid out to members and is responsible for doing so fairly. We are not responsible for an owner's decisions, but we may act on abuse.",
        "If your account is closed (by you, or by us under section 11), its chips and items are lost and are not refunded, except as our Refund policy or the law requires.",
      ],
    },
    {
      id: "purchases",
      h: "6. Purchases and subscriptions",
      blocks: [
        {
          list: [
            "Prices are shown in Indian rupees (or your local currency in Google Play) and include applicable taxes such as GST unless shown otherwise.",
            "On the website, payments are processed by **Razorpay**; in the app, by **Google Play**. Their terms apply to the payment. We never receive your card, UPI or bank details.",
            "What you buy is normally credited instantly. If it isn't, contact us with your payment ID.",
            "**Subscriptions (such as Plus) renew automatically** at the end of each period until you cancel. You can cancel at any time (on the website from your account, in the app from Google Play → Subscriptions); you keep the benefits until the end of the period already paid for. We will tell you before a price change affects your next renewal.",
            "Refunds are covered by our [Refund policy](/refunds).",
          ],
        },
      ],
    },
    {
      id: "conduct",
      h: "7. Rules of conduct",
      blocks: [
        "You agree not to host, display, upload, share or send (including as a display name, club name, club description, drawing or chat) any information that:",
        {
          list: [
            "belongs to someone else and you have no right to;",
            "is obscene, pornographic, paedophilic, invasive of another's privacy (including bodily privacy), insulting or harassing on the basis of gender, racially or ethnically objectionable, relating to or encouraging money laundering or gambling, or otherwise against the law;",
            "is harmful to children;",
            "infringes any patent, trademark, copyright or other proprietary right;",
            "deceives or misleads about where a message came from, or knowingly spreads false or misleading information;",
            "impersonates another person;",
            "threatens the unity, integrity, defence, security or sovereignty of India, friendly relations with foreign states or public order, incites an offence, or insults another nation;",
            "contains a virus or other harmful code, or is meant to interrupt, destroy or limit any computer resource;",
            "is false and untrue and is published with the intent to mislead or harass for financial gain or to cause injury;",
            "violates any law in force.",
          ],
        },
        "You also agree not to: cheat, use bots, scripts, modified clients or exploits; manipulate scores, leaderboards, rewards, referrals or matches (including by colluding, or creating extra accounts); harass, threaten or bully other players; interfere with the Service or try to access accounts, data or systems you are not allowed to; or copy, scrape, resell or reverse-engineer the Service except as the law allows.",
        "We may remove content, reset scores or balances, and suspend or close accounts that break these rules. Where the law requires, we will preserve information and report to the authorities.",
      ],
    },
    {
      id: "content",
      h: "8. Your content",
      blocks: [
        "You keep the rights in what you create, such as drawings shared in Draw a Tune and your club's name and description. You give us a worldwide, royalty-free, non-exclusive licence to host, show, copy and adapt it, only to run and promote the Service, for as long as it is in the Service. You confirm that you have the right to share it.",
      ],
    },
    {
      id: "ip",
      h: "9. Our intellectual property",
      blocks: [
        `The Service, its games, characters (including Senevi), artwork, sounds, software, logos and the ${CO.brand} name are owned by us or our licensors and protected by law. Except for the licence in section 3, these Terms give you no rights in them. If you believe something in the Service infringes your rights, write to our Grievance Officer (section 15).`,
      ],
    },
    {
      id: "third",
      h: "10. Ads and third parties",
      blocks: [
        "The Service shows ads, and links to and embeds services run by others. We are not responsible for third-party content, products, offers or privacy practices; your dealings with them are between you and them.",
      ],
    },
    {
      id: "termination",
      h: "11. Suspension and closing accounts",
      blocks: [
        "You can stop using the Service and delete your account at any time.",
        "We may suspend or close your account, or limit features, if you break these Terms, if the law requires it, to protect other players or the Service, or if your account has been inactive for a long time (we will warn you first). Where reasonable, we will tell you why. If we close the Service entirely, we will give reasonable notice in the Service.",
      ],
    },
    {
      id: "disclaimer",
      h: "12. Disclaimers",
      blocks: [
        "The Service is provided free of charge \"as is\" and \"as available\". To the extent the law allows, we make no promises that it will always be available, free of errors or that scores, ranks or rewards will never need to be corrected. Nothing in these Terms limits rights you have under the Consumer Protection Act, 2019 or any other law that cannot be excluded.",
      ],
    },
    {
      id: "liability",
      h: "13. Limitation of liability",
      blocks: [
        "To the extent the law allows: we are not liable for indirect, incidental, special or consequential loss, or for loss of data, profit or goodwill; and our total liability to you for all claims relating to the Service is limited to the amount you paid us in the 12 months before the claim arose, or ₹1,000 if you have paid nothing. This does not limit liability for fraud, or for death or personal injury caused by our negligence, or anything else that cannot be limited by law.",
        "You agree to indemnify us against claims, losses and costs arising from your breach of these Terms or misuse of the Service.",
      ],
    },
    {
      id: "law",
      h: "14. Governing law and disputes",
      blocks: [
        `These Terms are governed by the laws of India. Please first contact our Grievance Officer so we can try to resolve any dispute informally within 30 days. If it is not resolved, the courts at ${CO.courtsCity} have exclusive jurisdiction, without affecting your right to approach a consumer commission under the Consumer Protection Act, 2019.`,
      ],
    },
    { id: "grievance", h: "15. Grievance Officer and contact", blocks: [...GRIEVANCE, `For general questions: ${CO.email}.`] },
    {
      id: "general",
      h: "16. General",
      blocks: [
        {
          list: [
            "**Changes:** we may update these Terms. We will change the date at the top and, for important changes, tell you in the Service before they apply. Continuing to use the Service after that means you accept them.",
            "**Severability:** if any part of these Terms is found unenforceable, the rest stays in effect.",
            "**No waiver:** if we don't enforce a right immediately, we still keep it.",
            "**Assignment:** you may not transfer these Terms; we may transfer them to a successor of our business.",
            "**Force majeure:** we are not responsible for delays or failures caused by events beyond our reasonable control.",
            "**Entire agreement:** these Terms, the Privacy policy and the Refund policy are the whole agreement between you and us about the Service. If they are translated, the English version prevails.",
          ],
        },
      ],
    },
  ],
};

/* ============================================================
   Refund and cancellation policy
   ============================================================ */
export const REFUNDS: LegalDoc = {
  slug: "refunds",
  title: "Refund and cancellation policy",
  intro: [
    `This policy covers payments to ${CO.brand} (${CO.legalName}) for chip packs, Plus and ad-free passes on ${CO.site} and in the ${CO.app}. It forms part of our [Terms of use](/terms).`,
    "Everything we sell is digital content that is delivered instantly. **We do not sell or ship physical goods.**",
  ],
  sections: [
    {
      id: "rule",
      h: "1. Our approach",
      blocks: [
        "Because purchases are credited to your account immediately, they are generally not refundable once delivered. We still review every request **individually** and will refund where it is fair to do so, taking into account whether the chips or benefits have been used, how long ago the purchase was made and the reason for the request.",
      ],
    },
    {
      id: "always",
      h: "2. When we will always refund",
      blocks: [
        {
          list: [
            "You were charged but the chips, Plus or ad-free pass were not credited, and we cannot credit them.",
            "You were charged more than once for the same order.",
            "A fault on our side meant you could not receive or use what you paid for, and we cannot fix it.",
          ],
        },
        "If you think a payment was made without your permission, also contact your bank or card issuer straight away.",
      ],
    },
    {
      id: "decline",
      h: "3. When we may decline",
      blocks: [
        {
          list: [
            "The chips have been spent or the benefits used.",
            "The request is made long after the purchase (we ask for requests within 30 days).",
            "The account was closed for breaking our Terms of use, or the request appears to be an attempt to abuse refunds.",
          ],
        },
      ],
    },
    {
      id: "subs",
      h: "4. Subscriptions and cancellation",
      blocks: [
        "You can cancel Plus at any time; it will not renew and you keep the benefits until the end of the period already paid for. Cancelling does not refund the current period, but you may still ask under section 1. Because content is delivered at once, an order cannot be cancelled after payment; please ask for a refund instead.",
      ],
    },
    {
      id: "play",
      h: "5. Purchases in the Android app (Google Play)",
      blocks: [
        "Purchases in the app are processed by Google Play. You can request a refund from Google within the period Google allows, through Google Play → Order history, under [Google Play's refund policy](https://support.google.com/googleplay/answer/2479637). You may also write to us and we will help.",
      ],
    },
    {
      id: "how",
      h: "6. How to ask for a refund",
      blocks: [
        `Write to ${CO.email} from your account email with: the date and amount, the Razorpay payment ID (starts with "pay_") or Google Play order number (starts with "GPA."), and what went wrong. We reply within 7 working days.`,
        "Approved refunds go back to the original payment method, normally within 5–7 working days after approval (banks may take longer). When a purchase is refunded, the chips or benefits it gave are removed from your account; if they have already been spent, your balance may be reduced accordingly.",
      ],
    },
    {
      id: "grievance",
      h: "7. Complaints",
      blocks: [`If you are unhappy with how your request was handled, contact our Grievance Officer, ${CO.grievanceName}, at ${CO.grievanceEmail}. You also keep all your rights under the Consumer Protection Act, 2019.`],
    },
  ],
};

export const LEGAL_DOCS = { privacy: PRIVACY, terms: TERMS, refunds: REFUNDS };
