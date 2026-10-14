export type LegalDocument = "terms" | "privacy";

export const LEGAL_TITLES: Record<LegalDocument, string> = { terms: "Terms of Service", privacy: "Privacy Policy" };
export const LEGAL_LAST_UPDATED = "October 14, 2026";
export const PRIVACY_LAST_UPDATED = LEGAL_LAST_UPDATED;

export const TERMS_OF_SERVICE = `Stella — FROMYOU, LLC
Last updated: October 14, 2026

1. Who we are and what these Terms cover

These Terms of Service ("Terms") govern the Stella service operated by FROMYOU, LLC, a Delaware limited liability company ("FROMYOU," "we," "us," or "our"), including our hosted backend and APIs, websites, and official desktop, browser, and mobile applications (together, the "Service"). They also cover our hosted agent execution, Drive, sharing and app-hosting features, and Stella Crew for Slack when you use those features.

By using the Service, you agree to these Terms. If you use it for an organization, you represent that you have authority to bind that organization; "you" then includes that organization. If you do not agree, do not use the Service.

Stella's code is provided under the MIT License, except components identified as having other licenses. These Terms do not restrict rights granted by those licenses. Section 12 addresses self-hosting.

Our Privacy Policy explains our handling of personal information. It is not permission to use your data for purposes beyond those described there.

2. Eligibility and accounts

You must be at least 13 and old enough under applicable law to use the Service. If you are under the age of legal majority where you live, a parent or legal guardian must review and agree to these Terms and supervise your use. We do not knowingly offer the Service to children under 13.

A Stella account is required to use our hosted assistant service. You can authenticate using the available email or social sign-in methods. Visiting public pages or opening a public share link does not require an assistant account. You are responsible for keeping your account, devices, sign-in links, API keys, and connected accounts secure, and for activity you authorize through them. Let us know promptly if you suspect unauthorized access. You are not responsible for unauthorized activity to the extent applicable law provides otherwise.

3. What Stella does

Stella coordinates AI agents that can work on your computers, in your browser and applications, with connected accounts, and in hosted sandboxes. Capabilities include reading and changing files, executing commands, using websites, sending communications, working with repositories, generating media, scheduling work, creating apps and previews, and synchronizing conversations and files across devices.

You can use Stella-managed AI, supported provider API keys such as OpenRouter, or supported engine accounts such as Claude or ChatGPT. Availability depends on the client, execution location, connected accounts, plan, provider restrictions, and server configuration. Not every feature is available on every route or plan. Your own engine login or key does not make all hosted features free or prevent conversation and task records from being stored by Stella.

Stella is a research preview. Features may be incomplete, unreliable, changed, or discontinued. We do not guarantee uninterrupted availability or that any particular model, provider, integration, or feature will remain available. We will honor applicable notice, refund, and other consumer obligations when we change or discontinue paid services.

4. Your direction and responsibility for agents

Stella is a tool acting under your direction. You are responsible for the tasks, access, permissions, and instructions you give it, and for the actions agents take on your behalf, to the extent permitted by law. This applies whether work runs on your computer, another device, a hosted sandbox, a schedule, or a connected account.

An instruction may require intermediate steps and access to relevant content. Grant only permissions you are authorized to grant and that are appropriate for the task. You must have the necessary rights to the files, accounts, systems, personal information, and other material you direct Stella to use. A request to do work is not permission to access someone else's systems without authorization or to disregard the law.

AI can misunderstand instructions, follow misleading material, produce incorrect outputs, and perform unintended or irreversible actions. Examples include purchases or payments, messages or posts sent to others, files changed or deleted, credentials exposed, code executed or deployed, and actions in third-party accounts. Tasks may continue in the background or run later under a schedule.

Review important actions and verify their results. Keep backups; check recipients, amounts, permissions, generated code, and deployment targets; and do not give agents access to systems where a mistake would create a risk you cannot accept. Revoke access or stop work when needed. A cancellation may not undo an action already performed or a request already sent to a third party.

Stella may request confirmations and apply security checks. These safeguards are not guarantees that every consequential action will be caught or that every result will be correct. Approval of a task can cover its related steps without a new prompt for each step. Do not rely on an agent as the sole decision-maker for safety-critical, legal, medical, financial, or other consequential decisions; obtain appropriate professional advice where needed.

FROMYOU does not undertake to supervise, individually review, or approve each action taken in response to your instructions. To the extent permitted by law, FROMYOU is not responsible for agents' actions or outcomes on your behalf, including purchases, communications, file changes, deployments, or third-party account actions. This allocation of responsibility does not exclude our own liability where the law does not allow it; sections 15 and 16 apply.

5. Your content and data

You retain your rights in your inputs, files, conversations, and other content. As between you and FROMYOU, we do not claim ownership of outputs generated for you. AI outputs may not be unique, accurate, protectable by copyright, or free of third-party rights. You are responsible for reviewing them and obtaining rights needed for your use.

You authorize us and the service providers needed for features you choose to host, process, transmit, reproduce, and display your content only as necessary to provide, secure, maintain, and deliver the Service and comply with law. This includes submitting relevant context to the selected AI provider, synchronizing devices, executing tasks, and displaying content to recipients or collaborators you choose. It is not permission to sell your personal information, use private conversations for advertising, or train generalized AI models on your conversation content.

Ordinary conversations and task records are stored in our hosted infrastructure, including when agents run locally or use your own engine. Files and credentials may also remain on a device or be stored for hosted work. The Privacy Policy describes those distinctions. Deleting an application or a local cache does not delete hosted content.

6. AI engines and connected services

Prompts, attachments, conversation context, tool results, and other task content may be sent to named third parties that provide AI, search, media, or integration services. See the Privacy Policy and in-app AI data-sharing disclosure for recipients and routing. Provider availability and data practices can differ; we do not promise zero retention by every provider.

When you connect a Claude, ChatGPT, or other engine account or supply an API key, you authorize the supported use of that account or key for your requests. You remain responsible for the provider's fees, usage limits, account permissions, and terms. Account connections and credential availability can depend on where work runs. We do not sell you rights to a third-party subscription or guarantee that a provider will permit or continue a particular integration.

Connecting another service authorizes Stella to perform the actions within the access you approve and the tasks you direct, including ongoing or scheduled tasks. Disconnecting access does not undo completed actions or remove copies already stored in conversations or by the other service. Third-party services, websites, MCP servers, models, skills, and extensions have their own terms and privacy practices. Review them before granting access. Nothing here limits your rights against us for our own conduct under applicable law.

7. Free allowance, paid plans, and billing

Our hosted Service offers free and paid plans. The free plan includes a one-time managed-use allowance, not a recurring promise of unlimited or periodically renewed free inference. Paid plans offer the limits and capabilities shown at purchase. Some capabilities require a paid plan even if you bring your own model account or key. Usage can include model inference and other metered hosted work; the plan display explains applicable allowances and limits.

The price, billing interval, included features, usage limits, and any applicable taxes are disclosed before purchase. Paid subscriptions automatically renew for the disclosed interval unless canceled. By subscribing, you authorize recurring charges to your selected payment method through the applicable billing provider. Website and desktop subscriptions are processed through Stripe. If a subscription is offered through Apple or Google, that store's billing and subscription rules also apply, and you must manage that subscription through the store.

Usage limits can operate over more than one time window. We may restrict managed or hosted features when an allowance or limit is reached. An allowance has no cash value and is not transferable. Where extra-use credit is offered, it is a separate one-time purchase at the price shown, not a subscription renewal or a guarantee that every capability becomes available. Buying a plan or credit does not cover charges your own model provider, connected services, or self-hosting infrastructure bills to you.

You can cancel through the available billing-management controls. Cancellation generally stops the next renewal, and access to paid features continues until the end of the paid period. Uninstalling an app does not cancel a subscription. If you delete an account, check that any separately store-billed subscription is also canceled.

Except where required by law, by the applicable store, or expressly offered by us, fees are nonrefundable and we do not provide refunds for a partly used billing period or unused allowance. This does not limit mandatory cooling-off, withdrawal, refund, or other consumer rights. Contact contact@fromyou.ai about a billing error or refund request.

We will give reasonable advance notice of material changes to subscription prices or paid-plan terms, obtain consent where required, and allow you to cancel before a change affects a renewal. Price changes do not retroactively increase a period already paid for.

8. Drive, sharing, hosted apps, and previews

Drive and hosted workspaces store files for use across your devices and agents. If you create a public share link or publish an app, site, or public preview, anyone with the link or address may be able to access it without a Stella account. Recipients can copy or redistribute content. A preview is not necessarily private merely because it was created from a private project. Check the selected audience and access settings before publishing; do not publish secrets or personal information you are not entitled to share.

Deleting a source file is not necessarily the same as deleting a separately published copy or link. Removing access through available controls cannot recall content others already downloaded, cached, or copied. Contact us if you need help removing hosted public content.

You are responsible for generated projects, code, apps, and deployments, including their security, permissions, legal compliance, content, and any commitments you make to their users. Hosting a project does not mean FROMYOU endorses it or provides a security audit. We may remove or restrict hosted content that violates these Terms or threatens security.

9. Stella Crew for Slack

Stella Crew works within the Slack workspaces, threads, and connected repositories enabled for it. Instructions, code, activity, outputs, and previews can be visible to the workspace members, thread participants, repository users, or preview audience permitted by those services and settings. Workspace or repository administrators can control access and integrations.

If you install or administer Crew for an organization, you must be authorized to connect the workspace, repositories, and credentials; inform affected users as required; and establish appropriate instructions and access permissions. Members must not direct Crew to disclose information to an audience that is not entitled to receive it. Slack, GitHub, and other connected services have their own policies and retention rules. Deleting an individual Stella account does not necessarily remove an organization's Slack messages, repository changes, or other members' records.

10. Acceptable use

Do not use our Service to:

• Break applicable law or infringe others' rights, including privacy and intellectual-property rights.
• Steal credentials, distribute malware, gain unauthorized access, commit fraud, or abuse or harass others.
• Publish unlawful content, including child sexual abuse material, or direct agents to cause unlawful harm.
• Circumvent our access controls, free-allowance eligibility, billing, or usage limits; interfere with the Service; or exploit security flaws instead of reporting them responsibly.
• Resell our hosted access or managed credits without our permission.

These restrictions apply to our Service, not to rights the MIT License grants in the source code. They do not prohibit lawful inspection, modification, reverse engineering, self-hosting, or building competing software under applicable open-source licenses.

11. Software, branding, and third-party components

Stella code made available under the MIT License may be used under that license. Components with their own notices or licenses remain subject to those licenses. These Terms do not replace or amend open-source licenses or revoke rights they grant.

The Stella name, logos, and FROMYOU branding are not licensed for use as your own branding or to imply our endorsement. Open-source code permissions do not authorize access to our hosted infrastructure, paid credits, third-party accounts, or provider subscriptions without the required authorization.

Modifying an app or installing a third-party skill, extension, or MCP server can change its behavior and data access. You are responsible for choosing and reviewing modifications and third-party components you use.

12. Independently operated and self-hosted servers

When you run Stella on your own server, you operate it and control its data; FROMYOU does not receive or process that server's data. These Terms and our Privacy Policy cover only our hosted Service and official apps, not your server. Official apps may still contact app stores or Expo for downloads and OTA updates, and, if you enable it, our push relay for notification delivery. Those limited official-app services remain subject to these Terms and our Privacy Policy.

13. Account deletion and ending use

You may stop using the Service at any time and request account deletion from the account-deletion control within the official apps. You may also contact contact@fromyou.ai for help or make a deletion request through our published account-deletion page. Export wanted data and manage subscriptions before deletion. The Privacy Policy explains deletion, legal retention, and copies outside our control. A self-hosted operator manages deletion and decommissioning of its own server.

We may suspend or terminate access for a material breach of these Terms, nonpayment, a security or abuse risk, a legal requirement, or discontinuation of the Service. Where reasonable and lawful, we will give notice and an opportunity to address the issue. We may act without advance notice when needed to protect users, security, or comply with law. Mandatory notice and refund rights still apply.

Termination of hosted access does not revoke rights already granted under the MIT License. Provisions that by their nature need to survive termination, including outstanding payment obligations, ownership and license provisions, liability limits, and dispute provisions, survive to the extent lawful.

14. No professional advice or guaranteed results

AI output is not guaranteed to be accurate, complete, lawful, suitable, or safe. Stella is not a substitute for independent professional advice, testing, supervision, or backups. You must evaluate outputs and actions before relying on them. We do not guarantee that generated code works, a task succeeds, an action can be reversed, or a third-party account remains available.

15. Warranty disclaimer

To the extent permitted by applicable law, the Service is provided "as is" and "as available," without warranties, express, implied, or statutory, including merchantability, fitness for a particular purpose, and noninfringement. We do not warrant uninterrupted, error-free, or completely secure operation or correct AI actions or outputs.

Nothing in these Terms excludes mandatory warranties, conformity obligations, reasonable-care duties, or other rights that cannot lawfully be excluded. The MIT License contains the separate warranty disclaimer for code provided under it.

16. Limits of liability

To the extent permitted by law, FROMYOU and its officers, employees, and agents are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or loss of profits, business, data, or goodwill arising from the Service. Subject to the same legal limits, we are not liable for losses caused by agents' actions taken on your behalf or third-party models, integrations, websites, or independently operated servers, including unintended purchases, communications, file changes, deployments, or account actions.

To the extent permitted by law, our aggregate liability for claims arising out of or relating to these Terms or the Service will not exceed the greater of (a) the amount you paid FROMYOU for the Service in the 12 months before the event giving rise to the claim and (b) US$50.

These exclusions and limits do not apply to liability that cannot legally be limited or excluded, including any applicable liability for fraud, fraudulent misrepresentation, willful misconduct, gross negligence, death or personal injury caused by negligence, or mandatory consumer or data-protection rights. They do not excuse our own conduct where applicable law makes us responsible. Where local law does not allow an exclusion or limit, the legally required standard applies instead.

17. Business-user indemnity

If you use the Service for a business or organization, to the extent permitted by law you will indemnify FROMYOU against third-party claims, damages, and reasonable costs arising from your unlawful instructions or content, violation of these Terms, or infringement of third-party rights, including through projects or actions you direct. This does not apply to claims caused by FROMYOU's own unlawful conduct, negligence, or breach of these Terms. We will promptly notify you of a claim and reasonably cooperate in its defense. You may not settle a claim in a way that admits liability or imposes obligations on us without our consent. This section does not impose an indemnity on consumers using the Service for personal purposes.

18. Governing law and disputes

Delaware law governs these Terms, without regard to conflict-of-law rules, except where mandatory law provides otherwise. Subject to mandatory consumer rights, courts with jurisdiction in Delaware will resolve disputes. If you are a consumer, this does not deprive you of protections of the mandatory laws of your country of residence or any right to bring a claim in your local courts. These Terms do not require arbitration or waive class-action rights.

19. Changes and general provisions

We may update these Terms, identify the revision date, and provide reasonable notice of material changes through the Service or by email. Changes apply prospectively. Where consent is required, we will obtain it; otherwise continued use after the notified effective date constitutes acceptance. If you do not agree, stop using the affected Service, cancel paid renewal, and export or delete your data as appropriate. Mandatory rights are unaffected.

If a provision is unenforceable, the remainder continues to apply. Failure to enforce a provision is not a waiver. These Terms and any expressly agreed purchase or organization-specific terms form the agreement for the Service; open-source licenses remain separate. Nothing creates an agency, partnership, or employment relationship between you and FROMYOU.

20. Contact

FROMYOU, LLC  
131 Continental Drive, Suite 305  
Newark, DE 19713, United States  
contact@fromyou.ai`;

export const PRIVACY_POLICY = `Stella — FROMYOU, LLC
Last updated: October 14, 2026

1. Scope and our privacy approach

FROMYOU, LLC, a Delaware limited liability company ("FROMYOU," "we," "us," or "our"), provides Stella's hosted services and official desktop, browser, and mobile applications. This Privacy Policy explains the personal information we process through those services, including agents, Drive, sharing, hosted apps and previews, and Stella Crew for Slack.

Stella is privacy-first, but it is not a local-only or entirely offline assistant. Our hosted service requires an account. It stores authoritative conversation and task records, including when work runs on your computer or uses your own model account or API key. Content relevant to a task can be sent to AI providers, connected services, or recipients you choose. We do not sell your personal information, use your conversations to serve advertising, or use your conversation content to train AI models. Our Google API commitments are stated in section 6.

Self-hosting

When you run Stella on your own server, you operate it and control its data; FROMYOU does not receive or process that server's data. These Terms and this policy cover only our hosted service and official apps, not your server. Official apps may still contact app stores or Expo for downloads and OTA updates, and, if you enable it, our push relay for notification delivery. Those services process the update or notification information needed to deliver them.

2. Information we collect and where it is stored

Account and sign-in information

For hosted accounts, we process your email address, name and profile information if supplied by you or an identity provider, account identifier, creation time, authentication records, and preferences. Available sign-in methods include email sign-in and supported identity providers such as Google and Apple; the web experience also supports passkeys. We use the Better Auth software for authentication. Stella's email/social sign-in does not require you to give us your Google or Apple password. Passkey authentication uses a public-key credential; your passkey's private key is managed by your authenticator, not sent to us.

Authentication and security records can include session identifiers, provider account identifiers, sign-in time, IP address, user-agent information, and device information. Signing in to Stella with Google is separate from granting access to Gmail, Drive, or other Google services.

Conversations, memory, and agent work

We store messages, replies, conversation and event history, saved memory, attachments and references, tool calls and results, agent status and activity, and settings needed to synchronize clients and continue work. Relevant content may include file excerpts, screenshots, web pages, email or calendar content, shell commands and output, generated code or media, voice transcripts, and other information you supply or direct agents to use. Engine session and continuation records, including Claude Code session transcripts and tool outputs, can also sync to Stella's hosted services so work can resume across execution locations.

Agents can read and change files, use applications and your signed-in browser, and act on connected accounts. We do not upload every file or browsing record simply because it exists on your computer. However, content an agent reads for a task may enter its model context, tool results, conversation, memory, or hosted workspace. Local execution is not a promise that the resulting information remains local. Public web requests also disclose information to the sites contacted.

The hosted service maintains authoritative records using Cloudflare infrastructure, including database and object storage. Supported clients keep local caches and execution state. Device-local information can include preferences, working files, screenshots, local memories, installed skills, credentials, browser state, and modification history. Deleting a cache or uninstalling an application does not delete the hosted record. Likewise, deleting hosted records does not automatically erase files or credentials remaining on your computer.

Hosted agents, Drive, and apps

Cloud agents run in hosted sandboxes. Files, dependencies, credentials needed for execution, browser state, working directories, and continuation/checkpoint data can be stored or restored between runs. A sandbox's lifecycle is not the retention period of your files or task history. Drive stores uploaded and generated files and metadata for cross-device use. Hosted apps, sites, and previews store the code, assets, deployment and access settings, and, where applicable, application data needed to serve them.

Device and routing information

We process device identifiers, device names and platform, public identity keys, connectivity and last-seen information, execution location and conversation mappings, permissions for cross-device work, and delivery or cancellation records. This lets us authenticate devices, route tasks, synchronize clients, and recover interrupted work. Mobile notifications use a push token and notification-related identifiers and metadata.

Connected accounts, schedules, and collaboration

We process authorization and connection records and the inputs, results, and selected content needed to use a service you connect, including external MCP servers. Ongoing features such as schedules, watches, and email summaries can access the connected service under your continuing instruction. Revoking a connection stops future authorized access but does not undo completed actions or remove all historical copies.

Stella Crew processes Slack installation, workspace, user, channel and thread identifiers, relevant messages, repository configuration and content, access and environment settings, agent instructions, results, and preview information. Slack messages, repository changes, and shared outputs may also remain with Slack, GitHub, the organization, or other participants. Other collaboration features, where used, can process profiles, memberships, messages, and shared-session activity.

Billing, usage, and support

Stripe processes hosted subscription payments. We process customer and subscription identifiers, plan and payment status, billing periods, invoices or billing references, and payment-method display information such as brand and last four digits where available. We do not store full payment-card numbers or CVVs. If store billing is offered, Apple or Google processes the transaction under its own policies.

We record usage and operational metadata such as account or owner identifier, model and engine, agent type, tokens, time, estimated or charged cost, plan, limits, success or failure, and request identifiers to operate the Service, enforce limits, reconcile billing, and prevent abuse. Support communications include the information you choose to send us. Technical and security logs may contain identifiers, request and error information needed to investigate incidents. These records are distinct from optional telemetry.

Optional discovery and information about other people

If you enable onboarding discovery or personalization, Stella can use selected information such as bookmarks, applications, and development-environment details to help personalize your experience. Discovery can be skipped. Sensitive discovery categories such as Messages & Notes are opt-in and disabled by default. Resulting context or memory may be processed by a model and synchronized to the hosted service; discovery is not a guarantee of device-only processing.

Files, messages, and connected accounts may contain other people's personal information. Use only information you are authorized to provide or process and follow any notice, consent, or organizational requirements that apply.

3. AI data sharing: who receives what

Using an AI feature sends the content needed for that feature to the selected AI service. Depending on the route and feature, recipients can include Anthropic, OpenAI, Google, xAI, DeepSeek, and Meta, and the AI gateways OpenRouter and Fireworks. User-configured routes can also include GitHub Copilot, Moonshot AI/Kimi, and Z.AI, when selected. A gateway may forward the request to its selected upstream model provider. Not every recipient receives every request.

The content can include your prompt, attachments and images, relevant conversation and memory, instructions, tool descriptions, file or screen content, tool results, audio, and model output. Stella's infrastructure can process these inputs and outputs to route work, synchronize clients, record history, and deliver the feature.

• Stella-managed models: requests go through our hosted infrastructure and the gateway or model provider used for that request.
• Your API keys: supported direct-device routes send requests to the chosen provider without our managed inference relay. Account-configured keys and cloud routes can instead be stored in Stella's credential infrastructure and used through our backend or model gateway. BYOK does not always mean local storage or a direct-device request.
• Claude and ChatGPT logins: the appropriate engine provider processes the session context and results. Credential availability depends on execution location. Conversation and engine-session records can still sync to Stella's hosted service.
• Voice and dictation: audio and related text can be sent to Meta's transcription service, OpenAI's realtime voice service, or another provider you configure for the supported route.
• Media generation and transcription: prompts, source files, audio, generated media, and job information can be sent to fal.ai and the selected media or transcription provider.

Our model relay may temporarily cache assembled response content, including text, reasoning, and tool arguments, for request recovery or reuse. These operational buffers are separate from encrypted conversation history and need not use the same application-level encryption. Retention follows the request and cleanup lifecycle rather than a universal ten-minute limit.

AI providers have their own retention, safety, and account policies. Some API routes use provider-side response storage or continuation features. Stella does not guarantee zero retention for every provider or route, nor does using your own key guarantee it. Check the selected provider's terms and available account controls. Our commitment not to train models on your conversation content does not substitute for a third party's separate policy; Google API data is additionally protected by section 6.

Official apps present an AI data-sharing disclosure and request the applicable consent when setting up AI use. You can decline and avoid those AI features. To stop sharing through a particular route, stop using it, change your engine, or disconnect it where supported. Changes do not recall data already sent. Consent to AI use is not consent to use Google API data for advertising or generalized model training.

4. Credentials and secure-input features

Stella stores credentials needed for the route you configure, which can include provider API keys, connected-service OAuth tokens, engine credentials, and MCP authorization. Some remain on the selected computer; others are held by hosted credential services for account-wide or cloud execution. Local credential protection uses the operating system's credential storage or other protected storage appropriate to the platform. Server-side credential vaults use encryption. A locally connected engine account is not necessarily available on every other device.

Secure-input cards let you provide a password, payment detail, or other sensitive value without intentionally putting it into ordinary chat. Fields marked sensitive are encrypted for delivery to the requesting execution host and represented to the agent by a handle. Remembered values are saved on the relevant computer using its supported protected credential storage. The agent can use the handle to enter the value into a designated website, command, or credential store. The destination then receives the value. Ordinary fields and any note you add may be visible to the agent. These features do not prevent disclosure if you paste a secret into chat, a tool reads an unrecognized secret from another source, or a destination exposes it in returned content.

5. Other recipients and service providers

In addition to the AI recipients in section 3, information reaches the following services when needed for the feature:

• Cloudflare: hosting, networking, databases and object storage, sandboxes, hosted sites, and related security infrastructure.
• Stripe: hosted subscription payments, billing management, and payment-related records.
• Expo and Apple/Google notification services: mobile push-token registration and notification delivery. Notification content and metadata may be processed by this delivery infrastructure according to the feature and your device settings.
• Composio: authorization, connection records, action inputs, and results for integrations routed through Composio. First-party connector availability varies; not every connector bypasses Composio.
• Exa and other configured search services: search queries, retrieved material, and request metadata for web search.
• Slack and GitHub: Crew messages, workspace and repository authorization and content, commits or other requested account actions, and collaboration data.
• Resend: email addresses and message content needed for sign-in, security, and other service emails.
• Google: Google sign-in and connected APIs, configured AI services, maps features, and the limited website advertising measurement described in section 9. These are separate purposes and data flows.
• Other services you choose: websites visited, apps and accounts connected, external MCP servers, recipients of messages or files, and providers you configure receive the information needed for the action you direct.

Third parties process data under their applicable terms and privacy policies. A connected service, recipient, or organization is not necessarily our subprocessor or under our control merely because Stella communicates with it.

We may disclose information when reasonably necessary to comply with law or valid legal process, protect safety and security, investigate abuse, enforce our agreements, or defend legal claims, subject to the stricter Google API rules below. If the business is involved in a merger, acquisition, or similar transaction, information may transfer subject to applicable law and privacy protections; Google API data remains subject to the Google API Services User Data Policy and Limited Use requirements.

6. Google Workspace connector and Google API Services user data

The following Google-specific disclosures and restrictions apply in addition to the rest of this policy. Our commitments on user-directed use, data processing, no generalized-model training, no sale or advertising or credit use, restricted human access, and Limited Use apply now to Google API data we receive, including through provider-routed integrations.

Google integrations currently use supported integration-provider routes, including Composio. Their authorization screens identify the permissions requested, and their applicable policies describe their credential processing. Connecting is optional. Disconnecting or disabling a service in Stella is not necessarily revocation of every scope in a shared Google grant; to revoke the grant itself, use your Google Account controls described below. Relevant content may still be retained in your conversation history after disconnection.

First-party connector disclosures for pending verification. The first-party Google Workspace connection flow is not currently enabled in the official hosted desktop application's connection wiring. Google OAuth verification and security assessment are in progress, not completed certifications. The first-party scope, granular-consent, and credential-storage disclosures below describe the connector covered by that pending verification and its intended supported behavior when released; they are not statements that every path described is available today or descriptions of the current Composio route. You do not need to enable this connector to use Stella.

The first-party Google Workspace connector covered by our verification is intended to let you optionally enable Stella to work with your Google account across Gmail, Google Calendar, Google Drive, Google Docs, Google Sheets, and Google Tasks. The following disclosures describe how that connector is intended to handle data received from Google APIs and apply in addition to the rest of this policy.

How You Connect — The connector is off until you choose to connect it, and connecting is always optional. Connecting starts a Google OAuth consent flow in which you sign in to Google and approve the access. You can connect Google services granularly — enabling one service at a time (for example, just Gmail or just Calendar), which incrementally expands a single shared Google grant to add each service's scopes — or use the one-tap Google Workspace bundle to enable all of the services listed above at once. A single consent screen does not necessarily cover every service; a granular connection requests only the scopes for the service you are enabling, and you review and approve the requested scopes on Google's consent screen before access is granted.

Data and Scopes We Access — When connected, only for the services you have connected and only as needed to carry out tasks you ask Stella to perform, the connector can access:

• Basic account identity — your Google account email address, basic profile, and an OpenID identifier, used to identify the connected account (scopes: openid, userinfo.email, userinfo.profile)
• Gmail — read, compose, send, and organize your messages, drafts, and labels; this does not include permanently deleting mail (scope: gmail.modify)
• Google Calendar — view and manage your calendars and events (scope: calendar)
• Google Drive — view and manage files in your Drive (scope: drive)
• Google Docs — create, read, and edit your documents (scope: documents)
• Google Sheets — create, read, and edit your spreadsheets (scope: spreadsheets)
• Google Tasks — view and manage your task lists (scope: tasks)

User-Directed Use — Stella accesses and acts on your Google data only after you connect the account and direct Stella (or a Stella agent acting on your instruction) to perform a task, such as reading an email, scheduling an event, or editing a document. Stella does not access your Google data for purposes you have not requested.

Where Your Credentials Live — Depending on how you run the connector, your Google OAuth tokens are stored in one of two ways. For on-device (local) execution, the OAuth access and refresh tokens Google issues are stored on your own device in Stella's protected credential store, encrypted at rest using your operating system's secure storage (the OS keychain or credential vault, via the desktop framework's safeStorage). For cloud or Store-based execution — where Stella carries out connector actions on your behalf from our backend — the tokens are persisted in FROMYOU's server-side credential vault, encrypted at rest using AES-256-GCM with a versioned master key. In both cases the confidential OAuth client secret is held only by FROMYOU's backend and is never shipped inside the app.

How Google Data Is Processed — Stella uses your connected Google account to carry out the tasks you request. Relevant content returned by Google APIs, such as emails, events, documents, or spreadsheets, may be processed by our services and stored in conversation history, tool results, or task records. When you direct Stella to reason over this content, it may be sent to the AI model provider handling your request and to service providers needed to operate that feature. We do not use Google Workspace data to develop, train, or improve generalized artificial-intelligence or machine-learning models.

No Sale, Advertising, or Credit Use — We do not sell or rent data received from Google APIs, and we do not transfer or use it to serve advertising or to determine creditworthiness or for lending purposes.

Restricted Human Access — FROMYOU personnel do not read data obtained through the Google connector, except where you give explicit consent to view specific data (for example, for support you request), where necessary for security purposes such as investigating abuse, where required to comply with applicable law, or where the data has been aggregated and anonymized for internal operations.

Retention, Deletion, and Revocation — Google tokens are retained while the connection remains active. Disconnecting the service removes the associated credentials. Google content included in conversation history or task records follows the retention and deletion practices described below; disconnecting a service does not delete that history. You can revoke Stella's access at any time from your Google Account under Security → Third-party access (https://myaccount.google.com/permissions), which invalidates the tokens held both on your device and in the vault; you can also disconnect individual services within Stella so Stella stops using those services. Disabling an individual service is not necessarily revocation of its OAuth scopes in a shared Google grant; use your Google Account controls to revoke the grant itself.

Limited Use — Stella's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

If another part of this policy could be read to permit a use or transfer of Google API data inconsistent with these commitments, this section controls. General statements about service improvement, security, third parties, or business transfers do not authorize prohibited Google API data use or transfer.

7. Sharing and collaboration visibility

A public Drive share link publishes a separate copy that anyone with the link may access without an account. Deleting or changing the original Drive file does not necessarily remove that published copy. Hosted apps and previews, including on stellasites.app, may be public or audience-restricted depending on their settings. Do not assume a preview is private because its repository is private. People with access may download, copy, or redistribute content; removing a link cannot retrieve their copies.

Crew replies and artifacts are delivered to the configured Slack thread and may be visible to the workspace participants and preview audience. Repository actions appear in the connected repository. The installing owner's granted tools and hosted files can affect what a Crew task can access; do not assume that a Slack task is technically isolated from all of that owner's personal Drive or memory. Use appropriate accounts and review permissions before adding Crew to a workspace.

Deleting your Stella account does not necessarily erase another participant's records, organizational Slack messages, repository history, public-recipient copies, or connected-service data. Contact us for help with content still hosted by FROMYOU; contact the relevant organization or third party for its copies.

8. How we use information and legal bases

We use the information described above to authenticate users; provide AI and agent features; synchronize and recover work; store and deliver files, messages, and apps; perform connected-service actions you direct; run schedules; process subscriptions; communicate service and security information; diagnose failures; prevent fraud and abuse; and meet legal obligations. We can use operational and telemetry metadata to understand reliability and improve the Service. This does not permit training generalized models on conversation content or prohibited use of Google API data.

Where EEA, UK, or similar data-protection law applies, FROMYOU relies as appropriate on:

• Contractual necessity to supply the service you request, maintain your account, and process billing.
• Legitimate interests in security, fraud prevention, service reliability, and communicating with you, balanced against your rights.
• Consent for optional data access or sharing where required, such as connected-account permissions and applicable AI-sharing, discovery, or advertising-measurement choices. You can withdraw consent for future processing; withdrawal does not affect lawful prior processing.
• Legal obligations for required financial records, responses to legal process, and other compliance duties.

Some information is needed to provide the Service; declining required account information or task context can make a feature unavailable. Permissions you grant Stella do not eliminate any responsibilities you or your organization have for other people's data. If you use Crew for an organization, your organization may have separate controller responsibilities; this public policy is not a negotiated data-processing agreement.

9. Telemetry, browser storage, and advertising measurement

Optional telemetry records metadata such as event types, timing, tokens and cost, model or agent type, and error codes, with account or installation identifiers pseudonymized by hashing. Its defined event fields do not include chat messages, prompts, file content, tool arguments, or tool outputs. Hashing is pseudonymization, not a guarantee of anonymity. Settings → Privacy lets you turn off telemetry, remove queued device telemetry, and stop applicable future device and account-level cloud telemetry reporting. In-flight events may still arrive. Necessary billing, usage, security, and operational records still continue as described above.

Our apps and websites use cookies or local storage for sign-in, sessions, preferences, and necessary operation. Google Ads measurement is separate from assistant content and Google connected-account data.

The production website configures a Google Ads tag for advertising measurement. The tag can load for visitors generally, not only people who arrive through an ad. Google may receive page and device information ordinarily sent by your browser, identifiers or cookies associated with the tag, ad-click identifiers when present (such as GCLID, GBRAID, or WBRAID), and download or signup conversion events. Stella's signup-conversion deduplication flag in browser local storage has no application-set expiry and remains until cleared.

We use this measurement for advertising measurement and campaign optimization, not to serve advertising based on your conversations or Google connected-account data. We do not use enhanced conversions or intentionally send customer-provided email addresses to Google for this measurement. We do not configure this measurement for remarketing or targeted advertising. Google processes received information under its own privacy policy and terms. You can limit measurement by blocking advertising scripts or cookies and clearing this site's local storage and cookies. Where applicable law requires consent for the tag or related storage, that legal requirement applies; this policy itself is not consent.

10. Security and access

We use reasonable technical and organizational measures appropriate to the data and feature. These include TLS for hosted communications, encryption in server-side credential vaults, access controls tied to accounts and devices, device identity signatures, rate limiting, and application-level encryption of conversation records. Conversation encryption uses conversation-specific keys protected by our key system; deletion of a conversation removes its active key material. This does not mean every stored metadata record, media job, file, or public share has the same encryption scheme, or that the Service is end-to-end encrypted against FROMYOU.

Stella attempts to redact known secrets from model-visible or stored outputs, but redaction cannot guarantee recognition of every secret. Protect credentials and do not put them in ordinary chat or public files.

Current admin and support interfaces expose account, billing, and enforcement metadata rather than general conversation, memory, or file-content browsing. The privacy settings include time-limited support grants, with a 24-hour expiry, and a visible recent support-access audit log. A grant is not routine staff access to your content. Google-data human access remains limited to the exceptions in section 6.

No system is completely secure. Public content, third-party destinations, modified clients, and self-hosted configurations have their own risks. We do not promise that encryption, a sandbox, or an approval prompt prevents every unauthorized disclosure or harmful action.

11. Retention and deletion

Retention depends on the data, feature, purpose, available controls, legal requirements, and third-party policies. We do not promise a universal retention period or immediate deletion from every storage layer.

• Conversations, memory, task history, Drive, and hosted workspaces: kept to provide history, synchronization, ongoing tasks, and recovery until removed through applicable controls or account deletion, subject to legitimate legal, security, and operational needs.
• Engine session records and checkpoints: can persist separately from a running sandbox or visible cache to enable continuation. Stopping a task or destroying a sandbox is not necessarily deletion of the associated history or workspace.
• Connected-account credentials: kept while needed for the active connection. Disconnect removes the relevant active credentials according to the connection's controls; historical tool results and connected-service copies are separate.
• Media inputs, outputs, and job records: kept to submit, deliver, manage, and troubleshoot the feature. Completed jobs and generated files can persist until removed; there is no blanket promise of automatic short-term deletion after completion.
• Public shares, apps, and previews: may be separate copies from source files or projects. Remove the publication separately where controls are available, or contact us for assistance.
• Account and authentication records: kept while your account is active and removed through account deletion, except records we must or may lawfully keep for security, compliance, or disputes.
• Billing, usage, and security records: kept as necessary for accounting, legal obligations, reconciliation, abuse prevention, and dispute resolution. A usage-limit reset is not deletion of historical billing records.
• Temporary delivery and operational records: expire or are cleaned up according to the record type; some routing, deduplication, or recovery records persist longer than a stream or session.
• Telemetry and support logs: metadata retained for their stated purposes. Turning telemetry off stops future optional reporting and removes queued device events; it is not a promise to erase all previously received telemetry or required operational records. The in-app support audit log shows a bounded recent history, not an unlimited archive.
• Google Ads signup-deduplication flag: remains in browser local storage until cleared; Google-held data follows Google's policies.
• Device-local data: remains until removed by you, an applicable client control, or your operating system; deleting a hosted account does not automatically erase all files on your devices.
• Organizational and third-party records: subject to the organization or provider's controls. Crew uninstall or individual account deletion is not a guarantee that all workspace messages, installations, preview records, or repository history are erased.

Account deletion initiates removal of eligible hosted account content and credentials and cancellation of the hosted Stripe subscription where applicable. Some cleanup occurs asynchronously. Deletion cannot recall information already sent to third parties or copied by recipients, and store subscriptions, if offered, must be managed with the store. If a control does not remove a separately hosted publication or a record you expect to be deleted, contact us.

12. Your controls and privacy rights

• Delete your hosted account: use Settings → Account → Delete account in the official apps, or the account-deletion page at https://stella.sh/delete-account. You may also contact contact@fromyou.ai. You do not need to reinstall a removed app to request deletion.
• Export and manage data: Settings → Privacy provides a JSON export of supported account data such as conversations, memory, and preferences. This is not necessarily a complete archive of every hosted file or third-party record. Download wanted Drive files separately and contact us for additional access or export requests.
• Manage sessions: account settings let you review active sessions and sign devices out. Security emails may notify you of new sign-ins.
• Control connected accounts and engines: disconnect services in Stella and revoke their authorization at the provider; change engines or remove your keys where supported. Google-specific controls are in section 6.
• Control telemetry, discovery, and notifications: use privacy and onboarding choices and your device's notification settings. Notifications can expose information on a lock screen; choose settings appropriate to your use.

Depending on where you live and which laws apply, you may have rights to access or know the personal information we hold, obtain a copy or portability, correct it, delete it, restrict processing, object to processing, withdraw consent, or appeal a decision about your request. We will handle eligible requests as required by law, verify identity as appropriate, and explain any lawful exception. An authorized agent may make a request where permitted. We will not discriminate against you for exercising applicable privacy rights.

California residents may have rights under the CCPA/CPRA where applicable, including rights concerning sale or sharing for cross-context behavioral advertising and certain uses of sensitive information. We do not sell personal information or use your conversations for targeted advertising; our limited advertising measurement is described in section 9. We do not use or disclose sensitive information to infer characteristics about you for advertising. Contact us about applicable requests, including correction, deletion, access, or opt-out rights.

If EEA or UK law applies, you may also object to processing based on legitimate interests and complain to your local data-protection supervisory authority. Contact us first if you would like us to help resolve a concern. Withdrawing optional consent does not affect processing justified by another applicable legal basis.

13. Children's privacy

Stella is not directed to children under 13. We do not knowingly collect personal information from children under 13. Users must also meet the age and guardian requirements in our Terms and applicable local law. If you believe a child has provided personal information in violation of these requirements, contact us so we can investigate and delete it as appropriate.

14. International processing

FROMYOU is based in the United States. Cloudflare and other providers operate infrastructure in multiple locations, and information may be processed in the United States and other countries where we or the applicable provider operate. Processing location can depend on the service and configuration; we do not promise that all hosted data stays in a particular country. Applicable law may require safeguards for international transfers. Contact us for information about safeguards applicable to your data.

15. Changes to this policy

We may update this policy and will identify the revision date. We will provide reasonable notice of material changes through the Service or by email and obtain consent where legally required. A policy update is not retroactive consent to a new use of your personal information. Google API data remains subject to section 6 and the Google API Services User Data Policy, including Limited Use.

16. Contact

For privacy questions, rights requests, deletion help, or security concerns:

FROMYOU, LLC  
131 Continental Drive, Suite 305  
Newark, DE 19713, United States  
contact@fromyou.ai`;

export const ACCOUNT_DELETION = `Stella — FROMYOU, LLC
Last updated: October 14, 2026

1. Delete within Stella

For a FROMYOU-hosted Stella account, open Settings → Account → Delete account in the official app and confirm the request. Account deletion is different from signing out, uninstalling the app, clearing a local cache, or resetting conversation data.

Before deleting, export wanted conversation data in Settings → Privacy and download wanted Drive files. Deletion removes your access and initiates removal of eligible hosted account data. Some cleanup runs asynchronously; it is not a promise that every copy is erased immediately.

2. Request deletion without the app

Email contact@fromyou.ai with the subject "Delete my Stella account" and identify the email address associated with your Stella account. If possible, send the request from that address. You do not need to reinstall Stella. Do not send a password, API key, or payment-card number.

We may ask you to verify control of the account before deleting it. We will respond with information about the request and its completion as applicable. If you are requesting deletion on behalf of someone else, explain your authority. You can use the same email address for deletion assistance or a narrower privacy request.

3. What deletion covers and its limits

Account deletion initiates removal of eligible Stella account information, conversations, memory, credentials, Drive and hosted workspace content associated with the account. Cleanup can remain pending and retry. We may retain limited information where needed for law, accounting, security, fraud prevention, or disputes, as explained in the Privacy Policy at https://stella.sh/privacy. We do not promise a single deletion deadline across all storage systems; contact us for your request's status.

Local files and credentials on your computers, data held by connected AI or integration providers, messages and repository history in Slack or GitHub, organizational records, and copies others downloaded are separate. Deleting your account cannot recall those copies. Contact the relevant provider or organization about its records, and remove remaining local data separately. Contact us if a public publication still hosted by FROMYOU needs removal.

4. Subscriptions

Hosted account deletion closes the account's Stripe customer record as part of the backend process; this is different from ordinary end-of-period subscription cancellation. To cancel renewal without deleting your account, use the available billing-management controls first. Uninstalling Stella does not cancel a subscription. If store billing is offered, manage that subscription with Apple or Google as well. Mandatory refund and consumer rights still apply; contact us about billing questions.


5. Contact

FROMYOU, LLC  
131 Continental Drive, Suite 305  
Newark, DE 19713, United States  
contact@fromyou.ai`;

export const AI_DATA_SHARING = {
  "intro": "Stella uses third-party AI services to respond and carry out tasks. By choosing \"I Understand & Agree,\" you allow the AI data sharing described below for the features you use. You can choose \"Don't Agree\" and avoid AI use. This is not consent to advertising or model training on your conversation content.",
  "data": "Stella sends the content needed for your request: your message, relevant conversation and memory, instructions, attached images and files, and task context such as file excerpts, screenshots, and tool results. If you use voice, recorded audio may be sent for transcription or live microphone audio for realtime voice. Media features can send prompts and source files for generation.",
  "hostedRecipients": "FROMYOU's Stella infrastructure on Cloudflare processes and stores conversation and task data. Depending on the selected route, AI content is sent to Anthropic, OpenAI, Google, xAI, DeepSeek, or Meta, directly or through OpenRouter or Fireworks. Meta's transcription service can receive recorded audio, and OpenAI can receive realtime voice audio. Media features can send prompts and files to fal.ai and the selected media provider. Only providers used for the chosen feature receive that feature's request. User-configured routes can also send data to GitHub Copilot, Moonshot AI/Kimi, or Z.AI when selected. If you configure another supported provider or connect an external service, that recipient also receives the data needed for the action you choose.",
  "selfHostedRecipients": "Your server's operator receives task data on its own Cloudflare account, not FROMYOU. Its configured AI recipients can include Anthropic, OpenAI, Google, xAI, DeepSeek, Meta, OpenRouter, Fireworks, GitHub Copilot, Moonshot AI/Kimi, Z.AI, or fal.ai, depending on the feature selected. The operator controls its server and data. Official apps may still contact app stores or Expo for updates and, if you enable it where available, FROMYOU's push relay for notification delivery.",
  "handling": "Hosted conversation and task records sync across your devices, even if your own model login or key is used. On an independent server, its operator stores those records. AI services separately process and may retain inputs and outputs under their own policies and account settings. Stella does not promise zero retention by every recipient. Stop using or disconnect a route to stop future requests; this does not recall data already sent. Read the full Privacy Policy at https://stella.sh/privacy."
} as const;
