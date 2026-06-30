/**
 * Download the Voynich page images from the Beinecke IIIF manifest, named by folio label.
 * The filename IS the folio→image mapping — no separate alignment step needed.
 *
 *   bun run download.ts                 # all canvases → ../iiif/<slug>.jpg + folio_map.json
 *   IIIF_WIDTH=full bun run download.ts # native resolution (default: 2000px wide)
 *   SKIP_BINDING=1 bun run download.ts  # skip covers/flyleaves/edges, folios only
 *
 * Resumable: existing files are skipped.
 */
import { mkdir, writeFile, readdir } from "node:fs/promises"
import { join, dirname } from "node:path"

const HERE = dirname(Bun.fileURLToPath(import.meta.url))
const MANIFEST = join(HERE, "..", "ivtff", "manifest.json")
const OUT_DIR = join(HERE, "..", "iiif")
// IIIF size. Default is a fit-box "!w,h" (preserve aspect, fit within) — keeps the Qwen-VL
// image-token count in the known-good range (~1.7–3 MP) so it doesn't overflow the model
// context. Override with IIIF_SIZE (e.g. "full", "2000,", "!1200,1600").
const SIZE = process.env["IIIF_SIZE"] ?? "!1200,1600"
const SKIP_BINDING = process.env["SKIP_BINDING"] === "1"
const CONCURRENCY = 6

const manifest = JSON.parse(await Bun.file(MANIFEST).text())
const canvases: any[] = manifest.items ?? []

const labelOf = (c: any): string => {
	const vals = Object.values(c.label ?? {})[0] as string[] | undefined
	return vals?.[0] ?? "unknown"
}
const imageUrlOf = (c: any): string | null => {
	const body = c.items?.[0]?.items?.[0]?.body
	const svc = body?.service?.[0]?.["@id"] ?? body?.service?.[0]?.id
	if (svc) return `${svc}/full/${SIZE}/0/default.jpg`
	return body?.id ?? null
}
/** A real folio label looks like "1r", "69v and 70r", "70v (part)" — binding is "[...]". */
const isFolio = (label: string) => /^\d/.test(label)
/** Filename slug: f1r, f69v_and_70r, f70v_part, _front_cover … */
const slugOf = (label: string): string => {
	if (label.startsWith("[")) return `_${label.slice(1, -1).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
	return `f${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "")}`
}

await mkdir(OUT_DIR, { recursive: true })
const have = new Set(await readdir(OUT_DIR).catch(() => []))

type Job = { index: number; label: string; slug: string; file: string; url: string }
const jobs: Job[] = []
const map: Record<string, { label: string; canvasIndex: number; imageUrl: string }> = {}

canvases.forEach((c, index) => {
	const label = labelOf(c)
	if (SKIP_BINDING && !isFolio(label)) return
	const url = imageUrlOf(c)
	if (!url) {
		console.warn(`no image url for canvas ${index} (${label})`)
		return
	}
	const slug = slugOf(label)
	const file = `${slug}.jpg`
	map[file] = { label, canvasIndex: index, imageUrl: url }
	jobs.push({ index, label, slug, file, url })
})

await writeFile(join(OUT_DIR, "folio_map.json"), JSON.stringify(map, null, 2))
console.log(`${jobs.length} images → ${OUT_DIR} (size=${SIZE}); folio_map.json written`)

let done = 0
let failed = 0
async function worker(queue: Job[]) {
	for (const job of queue) {
		if (have.has(job.file)) {
			done++
			continue
		}
		try {
			const res = await fetch(job.url)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			await Bun.write(join(OUT_DIR, job.file), res)
			done++
			console.log(`ok   [${done}/${jobs.length}] ${job.file}  (${job.label})`)
		} catch (e) {
			failed++
			console.error(`FAIL ${job.file} (${job.label}): ${(e as Error).message}`)
		}
	}
}

// round-robin split into CONCURRENCY queues
const queues: Job[][] = Array.from({ length: CONCURRENCY }, () => [])
jobs.forEach((j, i) => queues[i % CONCURRENCY]!.push(j))
await Promise.all(queues.map(worker))

console.log(`done: ${done} ok, ${failed} failed`)
