export interface LegalDoc { slug: string; title: string; short: string; sections: [string, string][] }
const CONTACT = "privacy@crystal.app (placeholder, to be replaced before launch)";
export const LEGAL: LegalDoc[] = [
  { slug: "terms", title: "Terms & Conditions", short: "Terms", sections: [
    ["Acceptance", "By creating an account or using Crystal (the \"Service\") you agree to these Terms. If you do not agree, do not use the Service."],
    ["The Service", "Crystal is a personal productivity proof of concept that provides task management, calendar views, weather information and an AI assistant. Features may change or be removed at any time while in preview."],
    ["Your account", "You are responsible for activity under your account and for keeping your sign-in method secure. You must be at least 13 years old (or the age of digital consent where you live)."],
    ["Acceptable use", "Do not misuse the Service, attempt to access other users' data, interfere with its operation, or use it for unlawful purposes."],
    ["AI output", "Responses from the AI assistant may be inaccurate or incomplete. Do not rely on them for medical, legal, financial or safety decisions."],
    ["Your content", "You keep ownership of the tasks and content you create. You grant us a limited license to store and process it solely to operate the Service for you."],
    ["Disclaimers and liability", "The Service is provided \"as is\" without warranties. To the maximum extent permitted by law, we are not liable for indirect or consequential damages."],
    ["Termination", "You may stop using the Service and request deletion at any time. We may suspend accounts that violate these Terms."],
    ["Changes", "We may update these Terms; continued use after changes take effect means you accept them."],
    ["Contact", `Questions: ${CONTACT}.`],
  ]},
  { slug: "privacy", title: "Privacy Statement", short: "Privacy", sections: [
    ["What we collect", "Account data (email address, name and profile image from your sign-in provider), content you create (tasks, notes, chat messages), and basic technical data (device type, approximate location if you allow weather lookups, error logs)."],
    ["How we use it", "To provide and secure the Service, show your tasks and calendar, answer your questions through the AI assistant, and improve reliability. We do not sell your personal information."],
    ["Service providers", "Supabase (authentication and database), Cloudflare (hosting and AI inference via Workers AI), Google (optional sign-in) and Open-Meteo (weather, receives only coordinates). Each processes data on our behalf under its own terms."],
    ["AI processing", "Messages you send to Crystal are processed by Cloudflare Workers AI to generate a reply. We do not use your content to train models."],
    ["Retention", "We keep your data while your account is active and delete it within 30 days of an account deletion request, except where law requires otherwise."],
    ["Your rights", "Depending on where you live (for example under the GDPR or CCPA/CPRA) you may access, correct, delete or export your data, and opt out of sale or sharing. Contact us to exercise these rights."],
    ["Security", "Data is encrypted in transit, and database row-level security restricts each account to its own records."],
    ["Children", "The Service is not directed to children under 13."],
    ["Contact", `${CONTACT}.`],
  ]},
  { slug: "cookies", title: "Cookies Policy", short: "Cookies", sections: [
    ["What we use", "Crystal uses strictly necessary browser storage (local storage and cookies) to keep you signed in and remember preferences such as sound on/off."],
    ["Analytics and advertising", "We do not use advertising cookies or third-party tracking cookies in this preview."],
    ["Managing storage", "You can clear site data in your browser settings at any time; doing so will sign you out."],
    ["Changes", "If we add non-essential cookies we will update this policy and ask for consent where required."],
  ]},
  { slug: "accessibility", title: "Accessibility Statement", short: "Accessibility", sections: [
    ["Our commitment", "We aim to meet WCAG 2.2 Level AA. Crystal supports keyboard navigation, visible focus indicators, screen-reader labels and the operating system's reduced-motion setting, which replaces the video background with a still image and stops animations."],
    ["Known limitations", "As a preview, some animated cockpit elements and color-contrast choices are still being reviewed."],
    ["Feedback", `If you encounter a barrier, contact ${CONTACT} and we will respond within 5 business days.`],
  ]},
  { slug: "do-not-sell", title: "Do Not Sell or Share My Personal Information", short: "Do Not Sell/Share My Personal Information", sections: [
    ["Our practice", "Crystal does not sell your personal information and does not share it for cross-context behavioral advertising."],
    ["Your right to opt out", "Residents of California and other states with similar laws have the right to opt out of the sale or sharing of personal information. Because we do not sell or share, no action is required, but you may still submit a request and we will record your preference."],
    ["Global Privacy Control", "We honor Global Privacy Control (GPC) browser signals as a valid opt-out request."],
    ["Submit a request", `Email ${CONTACT} with the subject \"Do Not Sell or Share\". We will confirm within 15 business days.`],
  ]},
];
