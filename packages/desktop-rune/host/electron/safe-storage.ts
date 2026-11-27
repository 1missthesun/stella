// safeStorage with Chromium os_crypt's formats (packages/node-shared/shared/os-crypt.ts), so values
// Electron Stella encrypted stay readable. `STELLA_RUNE_KEYCHAIN`: a keychain file of its own for
// test roots, so proofs never read the user's "<app> Safe Storage".

import { createOsCryptSafeStorage } from "../../../node-shared/shared/os-crypt";
import { app } from "./app";

export const safeStorage = createOsCryptSafeStorage({
  getName: () => app.getName(),
  getUserData: () => app.getPath("userData"),
});
