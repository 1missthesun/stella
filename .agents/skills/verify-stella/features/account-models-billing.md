# Account, models and billing

The top bar's right side carries identity, where Stella works, and model choice: **Where Stella works** (computer icon), **Models**, and the ⚙ **Account** menu. Usage and billing open from the Account menu.

## Sub-features

- `account-menu`: signed in, the ⚙ **Account** button (`button.shell-topbar-account-trigger`, named by nickname or `Account`; while the account is paused its name adds the reason) with Settings, Plan & usage, Theme, Stella on your phone, Connectors, Send feedback, Sign out. Signed out: **Sign in** plus a **Settings** gear.
- `execution-target`: **Where Stella works** (`shell/GlobalExecutionTargetControl.tsx`): a dialog with **This computer**, **Cloud** and the account's other computers; the checked row is the current target. Signed out or with cloud sync off it stays on this computer.
- `model-picker`: **Models** (`shell/GlobalModelsControl.jsx`): a dialog with **Assistant** and **Image** tabs, **Search models**, **Refresh model catalog**, provider groups (Stella with reasoning effort, Claude Code, ChatGPT, xAI, Meta, OpenRouter, Anthropic, OpenAI, GitHub Copilot, Google, Kimi, Z.AI, Cerebras, Local) each with **Sign in** or **Add key**, and **Show in composer** (pins the model chip in the composer). The trigger always says Models.
- `live-model-lists`: each provider's own model list (OpenRouter, Vercel AI Gateway, OpenCode, Anthropic, OpenAI, Google, xAI, Cerebras) feeds the picker on top of the catalog snapshot, on this computer and for keys saved to the account; every provider section accepts a typed model id, and an uncatalogued model runs shaped like its nearest sibling.
- `usage-billing`: **Plan & usage** shows the plan, allowance and upgrade; the usage page (`app/usage`) breaks spend down by thread and call. Checkout opens Stripe.
- `connectors-feedback`: **Connectors** (connected services) and **Send feedback** dialogs.

## Driving it with control-stella

Preconditions: an isolated test account (`--account pro|plus|max`, or `STELLA_VERIFY_METERED=1` / `STELLA_VERIFY_ALLOWANCE=spent` for budgets); never the developer's own credentials.

- **Account menu.** `drive click --selector button.shell-topbar-account-trigger`, then `inspect components` for the menu items.
- **Target.** `drive click --role button --name "Where Stella works"`, pick a row, reopen and read the checked row; for placement claims read the thread's `executor` and `runsOnDeviceId` (cloud reference).
- **Model.** `drive click --role button --name Models`, choose an option, reopen and read the selected option. The dialog's tabs are named `Stella's main assistant` and `Image generation provider`. **Show in composer** is an unnamed switch (`drive click --selector '.work-models-pin-switch [role=switch]'`); on, the composer shows a `Model: <name>` chip.
- **Plan.** Account › **Plan & usage**; with a spent allowance the near-limit and limit states show there and in the bell.
- **Live lists.** Save a provider key (Add key) and require a model only the provider's list has, then type an uncatalogued id and send a turn with it.

## Gotchas

- Model lists are scoped by provider, plan and target; an absent model may be correctly filtered ("not on your plan" goes to the bell).
- Billing and checkout are external side effects: never purchase, subscribe or submit payment without explicit authorization.
- BYOK turns need dev; a Preview's gateway can't run them.
- A signed-out verifier proves menus and blocked states, not account mutations.
