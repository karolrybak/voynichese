/**
 * Strip the `keywords` field from annotation records so the next `annotate.ts` run
 * regenerates them with the current prompt_keywords.md (features are kept untouched).
 *
 *   bun run reset-keywords.ts f1r f2r f3r     # specific folios
 *   bun run reset-keywords.ts --all           # every record
 *   bun run reset-keywords.ts --section=herbal # one section
 *
 * Then: bun run annotate.ts <same folios>   (or just `bun run annotate.ts`)
 */
import { readdir } from "node:fs/promises"
import { join, dirname } from "node:path"

const OUT_DIR = join(dirname(Bun.fileURLToPath(import.meta.url)), "out")
const args = process.argv.slice(2)
const all = args.includes("--all")
const section = args.find((a) => a.startsWith("--section="))?.split("=")[1]
const folios = new Set(args.filter((a) => !a.startsWith("--")).map((a) => (a.startsWith("f") ? a : `f${a}`)))

const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".json"))
let n = 0
for (const file of files) {
	const path = join(OUT_DIR, file)
	const rec = JSON.parse(await Bun.file(path).text())
	const match = all || (section ? rec.section === section : folios.has(rec.folio))
	if (!match || !("keywords" in rec)) continue
	delete rec.keywords
	await Bun.write(path, JSON.stringify(rec, null, 2))
	n++
	console.log(`reset ${rec.folio}`)
}
console.log(`\nstripped keywords from ${n} record(s) — re-run annotate.ts to regenerate`)
