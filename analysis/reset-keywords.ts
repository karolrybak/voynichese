/**
 * Strip the `keywords` field from annotation records so the next `annotate.ts` run
 * regenerates them with the current prompt_keywords.md (features are kept untouched).
 *
 *   node reset-keywords.ts f1r f2r f3r     # specific folios
 *   node reset-keywords.ts --all           # every record
 *   node reset-keywords.ts --section=herbal # one section
 *
 * Then: node annotate.ts <same folios>   (or just `node annotate.ts`)
 */
import { readFile, writeFile, readdir } from "node:fs/promises"
import { join, dirname } from "node:path"

const OUT_DIR = join(import.meta.dirname, "out")
const args = process.argv.slice(2)
const all = args.includes("--all")
const section = args.find((a) => a.startsWith("--section="))?.split("=")[1]
const folios = new Set(args.filter((a) => !a.startsWith("--")).map((a) => (a.startsWith("f") ? a : `f${a}`)))

const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".json"))
let n = 0
for (const file of files) {
	const path = join(OUT_DIR, file)
	const rec = JSON.parse(await readFile(path, "utf8"))
	const match = all || (section ? rec.section === section : folios.has(rec.folio))
	if (!match || !("keywords" in rec)) continue
	delete rec.keywords
	await writeFile(path, JSON.stringify(rec, null, 2))
	n++
	console.log(`reset ${rec.folio}`)
}
console.log(`\nstripped keywords from ${n} record(s) — re-run annotate.ts to regenerate`)
