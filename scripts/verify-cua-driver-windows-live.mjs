import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("CUA Windows live preflight must run on the owner's interactive Windows PC.");
  process.exit(2);
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const python = process.env.JARVIS_PYTHON || "python";
const result = spawnSync(
  python,
  [join(root, "windows-companion", "verify_cua_driver_windows_live.py")],
  { cwd: root, stdio: "inherit", timeout: 60000, windowsHide: true },
);
if (result.error) {
  console.error("CUA Windows preflight could not start:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
