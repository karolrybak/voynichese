/**
 * Parser for the ZL (Zandbergen-Landini) IVTFF transliteration (`../ivtff/ZL3b-n.txt`).
 * Yields one record per folio: ground-truth metadata ($I illustration type, $C Currier
 * language, $Q quire …) plus the EVA text. This is the join target for the image features.
 *
 * IVTFF essentials:
 *   <f1r>  <! $Q=A $P=A $I=T $C=1 …>      folio header carrying page variables
 *   <f1r.1,@P0>   <%>fachys.ykal.ar…<$>   a locus line; "." separates words
 * Inline markup we strip for a "basic EVA" word stream: <...> tags, [a:b] alternate
 * readings (we keep the first), {...} ligature groups, @NNN; special-char codes, and the
 * uncertainty markers ? * ! , (comma = uncertain space).
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const HERE = import.meta.dirname
const ZL_PATH = join(HERE, "..", "ivtff", "ZL3b-n.txt")

export interface Folio {
	id: string // "f1r"
	vars: Record<string, string> // { Q:"A", P:"A", I:"T", C:"1", … }
	section: string // human section name from $I
	text: string // cleaned, space-separated EVA words (all loci)
	words: string[]
	/** Words split by locus TYPE letter: P=paragraph, L=label, R=radial, C=circular. */
	wordsByType: Record<string, string[]>
}

export const SECTION_BY_ICODE: Record<string, string> = {
	H: "herbal",
	A: "astronomical",
	C: "cosmological",
	B: "biological",
	P: "pharmaceutical",
	Z: "zodiac",
	S: "recipes",
	T: "text_only",
}

const HEADER = /^<(f\d+[rv]\d*)>\s*<!\s*([^>]*)>/
// <f1r.1,@P0> → captures folio, the locus code ("@P0"), and the text. Type letter = first
// alphabetic char of the code (P/L/R/C…), modifier (@,+,=,*,&,~) ignored.
const LOCUS = /^<(f\d+[rv]\d*)\.[0-9]+,([^>]+)>\s*(.*)$/

/** Strip IVTFF inline markup from one locus line → space-separated EVA words. */
function cleanLine(raw: string): string {
	let s = raw
	s = s.replace(/\[([^\]:]*):[^\]]*\]/g, "$1") // [a:b] alternate → keep first
	s = s.replace(/<[^>]*>/g, "") // <%>, <$>, <!...> tags
	s = s.replace(/\{[^}]*\}/g, "") // {ligature} groups
	s = s.replace(/@\d+;?/g, "") // @254; special-char codes
	s = s.replace(/[?*!]/g, "") // uncertainty / illegible markers
	s = s.replace(/,/g, ".") // uncertain space → word break
	return s
		.split(".")
		.map((w) => w.trim())
		.filter(Boolean)
		.join(" ")
}

export function parseZL(content: string): Map<string, Folio> {
	const folios = new Map<string, Folio>()
	let cur: Folio | null = null
	for (const line of content.split("\n")) {
		if (line.startsWith("#")) continue
		const h = HEADER.exec(line)
		if (h) {
			const vars: Record<string, string> = {}
			for (const m of h[2]!.matchAll(/\$([A-Z])=([A-Za-z0-9]+)/g)) vars[m[1]!] = m[2]!
			cur = {
				id: h[1]!,
				vars,
				section: SECTION_BY_ICODE[vars["I"] ?? ""] ?? "unknown",
				text: "",
				words: [],
				wordsByType: {},
			}
			folios.set(cur.id, cur)
			continue
		}
		const l = LOCUS.exec(line)
		if (l && cur && l[1] === cur.id) {
			const cleaned = cleanLine(l[3]!)
			if (cleaned) {
				cur.text += (cur.text ? " " : "") + cleaned
				const type = l[2]!.replace(/[^A-Za-z]/g, "").charAt(0) || "?"
				;(cur.wordsByType[type] ??= []).push(...cleaned.split(" "))
			}
		}
	}
	for (const f of folios.values()) f.words = f.text ? f.text.split(" ") : []
	return folios
}

export async function loadZL(): Promise<Map<string, Folio>> {
	return parseZL(await readFile(ZL_PATH, "utf8"))
}

/** Parse any IVTFF-format transliteration (e.g. ivtff/IT2a-n.txt, ivtff/GC2a-n.txt). */
export async function loadIVTFF(path: string): Promise<Map<string, Folio>> {
	return parseZL(await readFile(path, "utf8"))
}

if (import.meta.main) {
	const f = await loadZL()
	console.log(`folios: ${f.size}`)
	const byI: Record<string, number> = {}
	let totalWords = 0
	for (const x of f.values()) {
		byI[x.section] = (byI[x.section] ?? 0) + 1
		totalWords += x.words.length
	}
	console.log("sections:", byI)
	console.log("total words:", totalWords)
	// label (L) word counts per section + how many folios carry any label
	const labelWords: Record<string, number> = {}
	const labelFolios: Record<string, number> = {}
	for (const x of f.values()) {
		const L = x.wordsByType["L"]?.length ?? 0
		if (L) {
			labelWords[x.section] = (labelWords[x.section] ?? 0) + L
			labelFolios[x.section] = (labelFolios[x.section] ?? 0) + 1
		}
	}
	console.log("label words by section:", labelWords)
	console.log("folios with labels by section:", labelFolios)
}
