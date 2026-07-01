/**
 * Schema-free probe: send a prompt + image to qwen3-vl-8b and print the RAW text output.
 * Use it to see what shape the model returns on its own, before designing a schema.
 *
 *   node probe.ts prompt_keywords.md f1v f67r
 *   node probe.ts prompt_generic.md f1v
 */
import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { PhotonImage, resize, SamplingFilter } from "@silvia-odwyer/photon-node"
import { keywordsJsonSchema, regionsJsonSchema } from "./schema.ts"

const HERE = import.meta.dirname
const IIIF_DIR = join(HERE, "..", "iiif")
const URL = process.env["DYFUZOR_URL"] ?? "ws://localhost:8787"
const MODEL = "qwen3-vl-8b"

const args = process.argv.slice(2)
// optional --schema=keywords|regions  → bound the output (else free-form)
const schemaName = args.find((a) => a.startsWith("--schema="))?.split("=")[1]
const schema =
	schemaName === "keywords" ? keywordsJsonSchema : schemaName === "regions" ? regionsJsonSchema : undefined
const positional = args.filter((a) => !a.startsWith("--"))
const [promptFile, ...folioArgs] = positional
if (!promptFile) throw new Error("usage: node probe.ts [--schema=keywords|regions] <promptFile> <folio...>")
const prompt = await readFile(join(HERE, promptFile), "utf8")
const folios = (folioArgs.length ? folioArgs : ["f1v"]).map((f) => (f.startsWith("f") ? f : `f${f}`))

function fitJpeg(bytes: Uint8Array): Uint8Array {
	const img = PhotonImage.new_from_byteslice(bytes)
	const w = img.get_width()
	const h = img.get_height()
	const scale = Math.min(1200 / w, 1600 / h, 1)
	const src = scale < 1 ? resize(img, Math.round(w * scale), Math.round(h * scale), SamplingFilter.Lanczos3) : img
	const out = src.get_bytes_jpeg(90)
	img.free?.()
	if (src !== img) src.free?.()
	return out
}

const ws = new WebSocket(URL)
ws.binaryType = "arraybuffer"
await new Promise<void>((res, rej) => {
	ws.addEventListener("open", () => res(), { once: true })
	ws.addEventListener("error", rej, { once: true })
})

function ask(dataUrl: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const onMsg = (e: MessageEvent) => {
			if (typeof e.data !== "string") return
			const m = JSON.parse(e.data)
			if (m.type === "log") return
			ws.removeEventListener("message", onMsg)
			if (m.type === "completion") resolve(m.text)
			else if (m.type === "error") reject(new Error(m.message))
			else reject(new Error(`unexpected: ${m.type}`))
		}
		ws.addEventListener("message", onMsg)
		const req: Record<string, unknown> = { type: "complete", model: MODEL, prompt, image: dataUrl, temperature: 0, maxTokens: 2048 }
		if (schema) req["schema"] = schema // bound the output → no runaway loop
		ws.send(JSON.stringify(req))
	})
}

for (const folio of folios) {
	const raw = await readFile(join(IIIF_DIR, `${folio}.jpg`))
	const dataUrl = `data:image/jpeg;base64,${Buffer.from(fitJpeg(new Uint8Array(raw))).toString("base64")}`
	console.log(`\n===================== ${folio}  (prompt: ${promptFile}) =====================`)
	try {
		console.log(await ask(dataUrl))
	} catch (e) {
		console.error(`FAIL: ${(e as Error).message}`)
	}
}
ws.close()
