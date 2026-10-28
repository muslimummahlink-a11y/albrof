export const devAuthBypass =
  import.meta.env.DEV && import.meta.env["VITE_DEV_AUTH_BYPASS"] === "true";
