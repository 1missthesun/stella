export const relocatedAgentBrief = (moved: {
  from: string;
  why: string;
  entries: number;
  cwd?: string;
  message: string;
  unstarted?: string;
  unstartedAttachments?: boolean;
}): string =>
  [
    `[Stella moved you here from ${moved.from}, because ${moved.from} ${moved.why}, and you run here now. ${
      moved.entries > 0
        ? `Your conversation above is as it was last saved to Stella's cloud; anything you did on ${moved.from} after that was not saved, so check before you rely on it.`
        : `None of your work on ${moved.from} reached Stella's cloud, so you start here from this message alone.`
    } Files in your working folder there${moved.cwd ? ` (${moved.cwd})` : ""} and anything you had running there did not come with you. What follows is Stella's message to you.]`,
    moved.message,
    ...(moved.unstarted
      ? [
          `[This was also waiting for you on ${moved.from} and never reached you there${
            moved.unstartedAttachments ? " (its attachments did not come with it)" : ""
          }; it is yours to handle now:]`,
          moved.unstarted,
        ]
      : []),
  ].join("\n\n");
