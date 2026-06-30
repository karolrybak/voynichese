/**
 * Voynich page annotator — production runner.
 * Iterates the folio-named images in `../iiif/`, looks up each folio's ground-truth section
 * ($I) from the ZL transliteration, drives qwen3-vl-8b with the matching per-section schema,
 * and saves the parsed feature vector to `out/<folio>.json`. Resumable (skips done).
 *
 *   bun run annotate.ts                       # every folio, per-section by $I
 *   bun run annotate.ts --section=herbal      # only one section
 *   bun run annotate.ts --limit=8 --sample    # one folio per section (quick check)
 *   bun run annotate.ts f1r f3r 75r           # explicit folios
 *   DYFUZOR_URL=ws://host:8787 bun run annotate.ts
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { type, type Type } from "arktype"
import { PhotonImage, resize, SamplingFilter } from "@silvia-odwyer/photon-node"
import { schemaForICode, jsonSchemaForICode, VoynichPage, keywordsJsonSchema } from "./schema.ts"
import { loadZL, type Folio } from "./zl.ts"

// Cap each image to a fit-box so the Qwen-VL image-token count stays within the model context
// (larger images overflow it → "failed to find a memory slot"). Source-size-agnostic.
const MAX_W = 1200
const MAX_H = 1600
function fitJpeg(bytes: Uint8Array): Uint8Array {
	const img = PhotonImage.new_from_byteslice(bytes)
	const w = img.get_width()
	const h = img.get_height()
	const scale = Math.min(MAX_W / w, MAX_H / h, 1)
	const src = scale < 1 ? resize(img, Math.round(w * scale), Math.round(h * scale), SamplingFilter.Lanczos3) : img
	const out = src.get_bytes_jpeg(90)
	img.free?.()
	if (src !== img) src.free?.()
	return out
}

const HERE = dirname(Bun.fileURLToPath(import.meta.url))
const IIIF_DIR = join(HERE, "..", "iiif")
const OUT_DIR = join(HERE, "out")
const URL = process.env["DYFUZOR_URL"] ?? "ws://localhost:8787"
const MODEL = "qwen3-vl-8b"

const prompt = await readFile(join(HERE, "prompt.md"), "utf8")
const promptKeywords = await readFile(join(HERE, "prompt_keywords.md"), "utf8")

const rawArgs = process.argv.slice(2)
const flag = (name: string) => rawArgs.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]
const has = (name: string) => rawArgs.includes(`--${name}`)
const sectionFilter = flag("section")
const limit = flag("limit") ? Number(flag("limit")) : Infinity
const sampleOnePerSection = has("sample")
const explicitFolios = rawArgs.filter((a) => !a.startsWith("--")).map((a) => (a.startsWith("f") ? a : `f${a}`))

const zl = await loadZL()
const folioMap: Record<string, { label: string; canvasIndex: number; imageUrl: string }> = JSON.parse(
	await readFile(join(IIIF_DIR, "folio_map.json"), "utf8"),
)

/** Primary folio id for an image label: "69v and 70r" / "70v (part)" → "f69v". */
function primaryFolio(label: string): string | null {
	const m = label.match(/^(\d+[rv])/)
	return m ? `f${m[1]}` : null
}

interface Job {
	folio: string
	file: string
	icode: string
	section: string
	meta: Folio | undefined
}

// Build jobs from the downloaded images, joined to ZL by folio id.
let jobs: Job[] = []
for (const [file, info] of Object.entries(folioMap)) {
	const folio = primaryFolio(info.label)
	if (!folio) continue // skip binding/cover/flyleaf
	const meta = zl.get(folio)
	const icode = meta?.vars["I"] ?? ""
	jobs.push({ folio, file, icode, section: meta?.section ?? "unknown", meta })
}
// de-dupe by folio (foldout "part" images can repeat a folio) — keep the first
const seen = new Set<string>()
jobs = jobs.filter((j) => (seen.has(j.folio) ? false : (seen.add(j.folio), true)))
jobs.sort((a, b) => a.folio.localeCompare(b.folio, undefined, { numeric: true }))

if (explicitFolios.length) jobs = jobs.filter((j) => explicitFolios.includes(j.folio))
if (sectionFilter) jobs = jobs.filter((j) => j.section === sectionFilter)
if (sampleOnePerSection) {
	const perSection = new Map<string, Job>()
	for (const j of jobs) if (!perSection.has(j.section)) perSection.set(j.section, j)
	jobs = [...perSection.values()]
}
jobs = jobs.slice(0, limit)

await mkdir(OUT_DIR, { recursive: true })
const done = new Set(await readdir(OUT_DIR).catch(() => []))

const ws = new WebSocket(URL)
ws.binaryType = "arraybuffer"
await new Promise<void>((res, rej) => {
	ws.addEventListener("open", () => res(), { once: true })
	ws.addEventListener("error", (e) => rej(e), { once: true })
})
console.log(`connected ${URL} — ${jobs.length} folio(s)`)

function annotate(
	dataUrl: string,
	promptText: string,
	schema: Record<string, unknown>,
): Promise<{ json: unknown; text: string }> {
	return new Promise((resolve, reject) => {
		const onMsg = (event: MessageEvent) => {
			if (typeof event.data !== "string") return
			const msg = JSON.parse(event.data)
			if (msg.type === "log") return
			ws.removeEventListener("message", onMsg)
			if (msg.type === "completion") resolve({ json: msg.json, text: msg.text })
			else if (msg.type === "error") reject(new Error(msg.message))
			else reject(new Error(`unexpected: ${msg.type}`))
		}
		ws.addEventListener("message", onMsg)
		ws.send(
			JSON.stringify({ type: "complete", model: MODEL, prompt: promptText, schema, image: dataUrl, temperature: 0, maxTokens: 1024 }),
		)
	})
}

const t0 = Date.now()
for (const job of jobs) {
	const outName = `${job.folio}.json`
	const outPath = join(OUT_DIR, outName)
	// Load any existing record so we can backfill just the missing channel(s) — features
	// and keywords resume independently.
	const existing = done.has(outName) ? JSON.parse(await readFile(outPath, "utf8").catch(() => "null")) : null
	const needFeatures = !existing?.features
	const needKeywords = !existing?.keywords
	if (!needFeatures && !needKeywords) {
		console.log(`skip  ${job.folio} (done)`)
		continue
	}

	const schema = job.icode ? jsonSchemaForICode(job.icode) : VoynichPage.toJsonSchema()
	const validator: Type = job.icode ? schemaForICode(job.icode) : VoynichPage
	const raw = await readFile(join(IIIF_DIR, job.file))
	const dataUrl = `data:image/jpeg;base64,${Buffer.from(fitJpeg(new Uint8Array(raw))).toString("base64")}`
	const start = Date.now()
	try {
		let features = existing?.features
		let valid = true
		if (needFeatures) {
			const r = await annotate(dataUrl, prompt, schema)
			features = r.json ?? safeParse(r.text)
			valid = !(validator(features) instanceof type.errors)
		}
		let keywords = existing?.keywords
		if (needKeywords) {
			const r = await annotate(dataUrl, promptKeywords, keywordsJsonSchema)
			keywords = r.json ?? safeParse(r.text)
		}
		// features + keywords + ground-truth join keys for downstream correlation
		const record = {
			folio: job.folio,
			section: job.section,
			icode: job.icode,
			currier: job.meta?.vars["C"] ?? null,
			quire: job.meta?.vars["Q"] ?? null,
			features,
			keywords,
		}
		await writeFile(outPath, JSON.stringify(record, null, 2))
		const secs = ((Date.now() - start) / 1000).toFixed(1)
		const did = [needFeatures && "feat", needKeywords && "kw"].filter(Boolean).join("+")
		console.log(`ok    ${job.folio}  ${secs}s  [${job.section}] (${did})${valid ? "" : "  ⚠ schema-invalid"}`)
	} catch (e) {
		console.error(`FAIL  ${job.folio} (${job.file}): ${(e as Error).message}`)
	}
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
ws.close()

function safeParse(s: string): unknown {
	try {
		const m = s.match(/\{[\s\S]*\}/)
		return m ? JSON.parse(m[0]) : { _raw: s }
	} catch {
		return { _raw: s }
	}
}
