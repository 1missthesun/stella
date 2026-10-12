const DEV_ACCEPTANCE_DEPLOYMENT_IDENTITY =
  "preview:basic-nightingale-118" as const;

type DevAcceptanceProbeEnvironment = {
  ENABLE_DEV_ACCEPTANCE_PROBES?: string;
  STELLA_DEPLOYMENT_IDENTITY?: string;
};

export const devAcceptanceProbesEnabled = (
  env: DevAcceptanceProbeEnvironment,
): boolean => {
  const deploymentIdentity = env.STELLA_DEPLOYMENT_IDENTITY?.trim() ?? "";
  return (
    env.ENABLE_DEV_ACCEPTANCE_PROBES === "1" &&
    deploymentIdentity === DEV_ACCEPTANCE_DEPLOYMENT_IDENTITY
  );
};
