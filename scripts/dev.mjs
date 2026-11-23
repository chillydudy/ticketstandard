import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const processes = [];
const next = spawn(process.execPath, [resolve(root, "node_modules", "next", "dist", "bin", "next"), "dev", ...process.argv.slice(2)], { cwd: root, stdio: "inherit", windowsHide: true });
processes.push(next);

// Start the optional local NAFNet service alongside Next when it has been installed.
const python = resolve(root, "local_ai", process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
if (process.env.TICKETSTANDARD_SKIP_AI !== "1" && existsSync(python)) {
  const ai = spawn(python, ["-m", "uvicorn", "local_ai.server:app", "--host", "127.0.0.1", "--port", "8765", "--no-access-log"], { cwd: root, stdio: "inherit", windowsHide: true });
  ai.on("exit", (code) => { if (code) console.error(`Local AI service exited with code ${code}. Refine will stay offline.`); });
  processes.push(ai);
}

next.on("exit", (code) => {
  for (const child of processes) if (child !== next) child.kill();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  for (const child of processes) child.kill(signal);
});
