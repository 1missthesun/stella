import { Effect } from "effect";
import { runDiscovery } from "./effect-io.js";
import * as DiscoveryService from "./service.js";

import type { AllUserSignalsResult } from "./types.js";
import type { DiscoveryCategory } from "@stella/contracts/discovery";
import type {
  DiscoveryCollectionOptions,
} from "./service.js";

export type { DiscoveryCollectionOptions };

export const collectAllSignals = async (
  StellaDataDir: string,
  categories?: DiscoveryCategory[],
  selectedBrowser?: string | null,
  selectedProfile?: string | null,
  options?: DiscoveryCollectionOptions,
): Promise<AllUserSignalsResult> =>
  runDiscovery(
    Effect.gen(function* () {
      const service = yield* DiscoveryService.Service;
      return yield* service.collectAllSignals(
        StellaDataDir,
        categories,
        selectedBrowser,
        selectedProfile,
        options,
      );
    }).pipe(Effect.provide(DiscoveryService.layer)),
  );
