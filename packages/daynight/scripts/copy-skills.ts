import { cpSync } from "node:fs";

cpSync(
  new URL("../src/commands/review/skills/daynight-review/", import.meta.url),
  new URL("../dist/commands/review/skills/daynight-review", import.meta.url),
  { recursive: true, errorOnExist: true, force: false },
);
