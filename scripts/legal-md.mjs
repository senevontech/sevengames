// Prints src/legal/legal.ts (Privacy policy, Terms of use, Refund policy) as Markdown, for legal
// review copies. Run: node --experimental-strip-types scripts/legal-md.mjs > legal.md
import { LEGAL_DOCS, UPDATED, CO } from "../src/legal/legal.ts";

const fix = (t) => t.replace(/\]\(\/(privacy|terms|refunds)\)/g, `](https://${CO.site}/$1)`);
const out = [];
for (const doc of Object.values(LEGAL_DOCS)) {
  out.push(`# ${doc.title}`, "", `Last updated: ${UPDATED}`, "");
  const blocks = (bs) => {
    for (const b of bs) {
      if (typeof b === "string") out.push(fix(b), "");
      else out.push(...b.list.map((l) => `- ${fix(l)}`), "");
    }
  };
  blocks(doc.intro);
  for (const s of doc.sections) {
    out.push(`## ${s.h}`, "");
    blocks(s.blocks);
  }
}
process.stdout.write(out.join("\n"));
