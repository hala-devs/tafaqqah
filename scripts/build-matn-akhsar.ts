/**
 * Builds the memorization segmentation of «أخصر المختصرات» from the canonical source
 * content/sources/akhsar-al-mukhtasarat-matn.md and writes:
 *  - content/matn-akhsar.source.txt     (one canonical unit per line — the importer's line-exact contract)
 *  - content/matn-akhsar.structure.json (sections → passages → units, all imported as DRAFT)
 *
 * Wording is never changed: units are cut only BETWEEN existing words (after punctuation), and a unit that spans
 * two source lines joins them with a single space. The integrity test proves the round trip.
 * No database, no AI. Usage: npm run content:build-matn
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMatnStructure, parseCanonicalMatn } from "../src/server/memorization/matn-source";

const root = process.cwd();
const canonical = parseCanonicalMatn(readFileSync(join(root, "content/sources/akhsar-al-mukhtasarat-matn.md"), "utf8"));
const structure = buildMatnStructure(canonical);

const unitLines = structure.sections.flatMap((s) => s.passages.flatMap((p) => p.units.map((u) => u.text)));
writeFileSync(join(root, "content/matn-akhsar.source.txt"), unitLines.join("\n") + "\n", "utf8");
writeFileSync(join(root, "content/matn-akhsar.structure.json"), JSON.stringify(structure, null, 2) + "\n", "utf8");

console.log(
  JSON.stringify(
    {
      sections: structure.sections.length,
      passages: structure.sections.reduce((n, s) => n + s.passages.length, 0),
      units: unitLines.length,
    },
    null,
    2,
  ),
);
