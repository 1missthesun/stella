export type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

export type FooterGroup = {
  title: string;
  items: FooterLink[];
};

export const chromeExtensionLink: FooterLink = {
  label: "Chrome Extension",
  href: "https://chromewebstore.google.com/detail/stella-browser/kfnchfpocpmdblhfgcnpfaaebaioojnl",
  external: true,
};

export const homeFooterGroups: FooterGroup[] = [
  {
    title: "Product",
    items: [
      { label: "Learn More", href: "/learn-more" },
      { label: "What Stella can fix", href: "/fix" },
      { label: "One chat", href: "/one-chat" },
      { label: "Voice", href: "/voice" },
      { label: "Stella Crew", href: "/crew" },
      { label: "Pricing", href: "/pricing" },
      { label: "Sign In", href: "/sign-in" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "What's New", href: "/learn-more/whats-new" },
      chromeExtensionLink,
      { label: "Download", href: "/download" },
      { label: "iPhone app", href: "https://apps.apple.com/us/app/stella-your-ai/id6761148311", external: true },
      { label: "Android app", href: "https://play.google.com/store/apps/details?id=com.fromyou.stella", external: true },
      { label: "Install for Linux", href: "/download#linux" },
      { label: "Install for Arch / Omarchy", href: "/download#linux" },
    ],
  },
  {
    title: "Community",
    items: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];
