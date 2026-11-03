import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const python = process.env.JARVIS_PYTHON || "python";
const result = spawnSync(
  python,
  [join(root, "windows-companion", "verify_cua_driver_offline.py")],
  { cwd: root, stdio: "inherit", timeout: 45000, windowsHide: true },
);
if (result.error) {
  console.error("CUA offline verification could not start:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
