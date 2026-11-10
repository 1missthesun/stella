import type { Metadata } from "next";
import { PageShell } from "@/components/landing/page-shell";
import { DownloadOptions } from "./download-options";
import d from "./download.module.css";

export const metadata: Metadata = {
  title: "Download",
  description:
    "Download Stella for Mac, Windows or Linux: the easy way to use ChatGPT or Claude on your computer, free with the plan you already have. iPhone and Android apps too.",
  alternates: { canonical: "/download" },
};

export default function DownloadPage() {
  return (
    <PageShell getHref="#get" className={d.page}>
      <DownloadOptions />
    </PageShell>
  );
}
