// Build the Android app's web files as a RELEASE build (its views count in the admin stats),
// then copy them into the Android project. Use this before building the Play Store bundle.
// Debug builds (npm run cap:sync) never count.
import { spawnSync } from "node:child_process";

const env = { ...process.env, VITE_RELEASE: "1" };
for (const cmd of ["npm run build:app", "npx cap sync android"]) {
  const r = spawnSync(cmd, { stdio: "inherit", shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
