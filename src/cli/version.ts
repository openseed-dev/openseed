import fs from "node:fs";
import path from "node:path";

export function readVersion(): string {
  try {
    const pkgPath = path.resolve(import.meta.dirname, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
