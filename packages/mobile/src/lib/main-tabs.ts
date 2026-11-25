import type {
  NavigationAction,
  ParamListBase,
  Router,
  TabNavigationState,
} from "expo-router/react-navigation";

type TabsState = TabNavigationState<ParamListBase>;

type TargetedPayload = { name?: unknown; params?: unknown };

function poppingNestedParams(params: unknown): unknown {
  if (!params || typeof params !== "object") return params;
  const nested = params as { screen?: unknown; params?: unknown };
  if (typeof nested.screen !== "string") return params;
  return { ...nested, pop: true, params: poppingNestedParams(nested.params) };
}

/**
 * expo-router sends `dismissTo` and `replace` of a sibling tab as POP_TO and
 * REPLACE actions, which React Navigation's tab router drops. Treat them as a
 * tab switch that pops any nested stack back to the requested screen.
 */
export function switchTabsOnPopOrReplace<Action extends NavigationAction>(
  original: Router<TabsState, Action>,
): Partial<Router<TabsState, Action>> {
  return {
    getStateForAction(state, action, options) {
      const payload = action.payload as TargetedPayload | undefined;
      if (
        (action.type === "POP_TO" || action.type === "REPLACE") &&
        typeof payload?.name === "string" &&
        state.routeNames.includes(payload.name)
      ) {
        return original.getStateForAction(
          state,
          {
            type: "NAVIGATE",
            payload: {
              name: payload.name,
              params: poppingNestedParams(payload.params),
            },
          } as Action,
          options,
        );
      }
      return original.getStateForAction(state, action, options);
    },
  };
}
