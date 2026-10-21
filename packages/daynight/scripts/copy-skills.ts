import { cpSync, statSync } from "node:fs";

const bundles = [
  "commands/review/skills/daynight-review",
  "commands/skill/skills/using-daynight",
];

for (const bundle of bundles) {
  if (!statSync(new URL(`../src/${bundle}/`, import.meta.url)).isDirectory()) {
    throw new Error(`Skill bundle source is not a directory: ${bundle}`);
  }
}

for (const bundle of bundles) {
  cpSync(
    new URL(`../src/${bundle}/`, import.meta.url),
    new URL(`../dist/${bundle}`, import.meta.url),
    { recursive: true, errorOnExist: true, force: false },
  );
}
