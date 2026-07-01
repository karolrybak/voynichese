/**
 * Image↔text correlation WITHIN a section.
 *
 * For each section, test every pair (visual_feature, text_token) for co-occurrence across
 * folios. Working within a section controls the dominant confound (section/$I, largely
 * Currier), so a surviving hit means "folios that look like X use token Y *beyond* what the
 * section already explains".
 *
 *   node correlate.ts                                   # herbal, structured features, words
 *   node correlate.ts --section=all --perm=500          # every section
 *   node correlate.ts --section=biological --unit=char3
 *   node correlate.ts --vf=keywords --loctype=L --unit=char3 --minDF=3 --minVF=3
 *
 * Flags:
 *   --section=NAME|all   which section(s)            (default herbal)
 *   --vf=features|keywords|both  visual-feature source (default features)
 *   --unit=word|char2|char3|char4  text unit        (default word)
 *   --loctype=all|P|L|R|C  locus type of the text   (default all)  P=para L=label R=radial C=circular
 *   --minDF=N  token must appear in ≥N folios        (default 5)
 *   --maxDF=F  …and ≤ this fraction of folios        (default 0.7)
 *   --minVF=N  feature present in ≥N folios          (default 4)
 *   --q=F      FDR threshold to call a "hit"         (default 0.1)
 *   --top=N    rows to print                         (default 30)
 *   --perm=N   permutation-null shuffles             (default 200; 0 to skip)
 *
 * Stats per pair: 2x2 contingency → two-sided Fisher exact p + phi (signed effect size).
 * Benjamini-Hochberg FDR across all pairs. Label-permutation null = how many "hits" appear
 * by chance. See ANALYSIS.md for how to read the output.
 */
import { readFile, readdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { loadZL, type Folio } from "./zl.ts"

const HERE = import.meta.dirname
const OUT_DIR = join(HERE, "out")

const args = process.argv.slice(2)
const str = (n: string, d: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d
const num = (n: string, d: number) => {
	const v = args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1]
	return v ? Number(v) : d
}
const sectionArg = str("section", "herbal")
const vfMode = str("vf", "features") // features | keywords | both
const unit = str("unit", "word") // word | char2 | char3 | char4
const loctype = str("loctype", "all") // all | P | L | R | C
const minDF = num("minDF", 5)
const maxDFfrac = num("maxDF", 0.7)
const minVF = num("minVF", 4)
const qThresh = num("q", 0.1)
const topN = num("top", 30)
const perm = num("perm", 200)

// ---------- load everything once ----------
const zl = await loadZL()
const outFiles = (await readdir(OUT_DIR).catch(() => [])).filter((f) => f.endsWith(".json"))
const records: any[] = []
for (const file of outFiles) records.push(JSON.parse(await readFile(join(OUT_DIR, file), "utf8")))

const sections =
	sectionArg === "all"
		? [...new Set(records.map((r) => r.section))].filter((s) => s && s !== "unknown").sort()
		: [sectionArg]

// ---------- feature / token extraction ----------
const STOP = new Set([
	"with","and","or","of","in","on","at","to","a","an","the","this","that","is","are","near","around",
	"above","below","left","right","top","bottom","corner","center","centre","side","page","number","of",
	"several","multiple","various","some","many","colored","coloured","style","overall","visible","drawn",
	"hand","illustration","drawing","painting","watercolor","parchment","paper","ink","sketch","depicting",
])

/** Text tokens for a folio: whole words, or char n-grams with ^/$ word-boundary markers. */
function textTokens(words: string[]): string[] {
	if (unit === "word") return words
	const n = unit === "char2" ? 2 : unit === "char4" ? 4 : 3
	const out: string[] = []
	for (const w of words) {
		const s = `^${w}$`
		for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n))
	}
	return out
}

/** Structured features → binary keys, e.g. "leaf_shape:serrated", "palette:green", "has_tubes". */
function structuredKeys(features: any): Set<string> {
	const keys = new Set<string>()
	for (const [c, on] of Object.entries(features?.palette ?? {})) if (on === true) keys.add(`palette:${c}`)
	for (const [k, v] of Object.entries(features?.features ?? {})) {
		if (v === true) keys.add(k)
		else if (typeof v === "string" && v !== "none" && v !== "na" && v !== "unclear") keys.add(`${k}:${v}`)
	}
	return keys
}

/** Keyword phrases → binary word-keys, e.g. "kw:serrated" (phrases are mostly unique → split). */
function keywordKeys(keywords: any): Set<string> {
	const keys = new Set<string>()
	if (!Array.isArray(keywords)) return keys
	for (const tag of keywords)
		for (const w of String(tag).toLowerCase().split(/[^a-z0-9]+/))
			if (w.length > 2 && !STOP.has(w)) keys.add(`kw:${w}`)
	return keys
}

function visualKeys(rec: any): Set<string> {
	const s = new Set<string>()
	if (vfMode !== "keywords") for (const k of structuredKeys(rec.features)) s.add(k)
	if (vfMode !== "features") for (const k of keywordKeys(rec.keywords)) s.add(k)
	return s
}

interface Page {
	folio: string
	vf: Set<string>
	words: Set<string>
}

// ---------- stats: lgamma → Fisher exact (two-sided) + BH ----------
function lgamma(x: number): number {
	const g = 7
	const c = [
		0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
		12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
	]
	if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x)
	x -= 1
	let a = c[0]!
	const t = x + g + 0.5
	for (let i = 1; i < g + 2; i++) a += c[i]! / (x + i)
	return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}
const lnFac = (n: number) => lgamma(n + 1)
function hyperLogP(a: number, b: number, c: number, d: number): number {
	const n = a + b + c + d
	return lnFac(a + b) + lnFac(c + d) + lnFac(a + c) + lnFac(b + d) - lnFac(a) - lnFac(b) - lnFac(c) - lnFac(d) - lnFac(n)
}
function fisher(a: number, b: number, c: number, d: number): number {
	const row1 = a + b
	const col1 = a + c
	const n = a + b + c + d
	const pObs = hyperLogP(a, b, c, d)
	const lo = Math.max(0, col1 - (n - row1))
	const hi = Math.min(row1, col1)
	let p = 0
	for (let x = lo; x <= hi; x++) {
		const lp = hyperLogP(x, row1 - x, col1 - x, n - row1 - col1 + x)
		if (lp <= pObs + 1e-7) p += Math.exp(lp)
	}
	return Math.min(1, p)
}
interface Hit {
	vf: string
	word: string
	a: number
	exp: number
	phi: number
	p: number
	q?: number
}
function bh(hits: Hit[]): Hit[] {
	const sorted = [...hits].sort((x, y) => x.p - y.p)
	const m = sorted.length
	let prev = 1
	for (let i = m - 1; i >= 0; i--) {
		const q = Math.min(prev, (sorted[i]!.p * m) / (i + 1))
		sorted[i]!.q = q
		prev = q
	}
	return sorted
}

// ---------- per-section analysis ----------
function analyze(section: string) {
	const pages: Page[] = []
	for (const rec of records) {
		if (rec.section !== section) continue
		const meta: Folio | undefined = zl.get(rec.folio)
		if (!meta) continue
		const baseWords = loctype === "all" ? meta.words : (meta.wordsByType[loctype] ?? [])
		if (baseWords.length === 0) continue
		pages.push({ folio: rec.folio, vf: visualKeys(rec), words: new Set(textTokens(baseWords)) })
	}
	const N = pages.length
	console.log(`\n######## ${section}  (vf=${vfMode} loctype=${loctype} unit=${unit}) ########`)
	if (N < 8) {
		console.log(`only ${N} usable folios — skipping (need ≥8).`)
		return
	}

	const df = (sel: (p: Page) => Set<string>) => {
		const m = new Map<string, number>()
		for (const p of pages) for (const k of sel(p)) m.set(k, (m.get(k) ?? 0) + 1)
		return m
	}
	const features = [...df((p) => p.vf)].filter(([, c]) => c >= minVF && c < N).map(([k]) => k)
	const words = [...df((p) => p.words)].filter(([, c]) => c >= minDF && c <= maxDFfrac * N).map(([k]) => k)
	console.log(`folios=${N}  features=${features.length}  tokens=${words.length}  pairs=${features.length * words.length}`)
	if (!features.length || !words.length) {
		console.log("nothing testable at these thresholds (try --minDF / --minVF lower, or --unit=char3).")
		return
	}

	const wPresence = new Map<string, boolean[]>()
	for (const w of words) wPresence.set(w, pages.map((p) => p.words.has(w)))
	function testAll(vfByPage: Set<string>[]): Hit[] {
		const hits: Hit[] = []
		const vfPresence = features.map((f) => vfByPage.map((s) => s.has(f)))
		for (let fi = 0; fi < features.length; fi++) {
			const fp = vfPresence[fi]!
			const fCount = fp.reduce((s, x) => s + (x ? 1 : 0), 0)
			for (const word of words) {
				const wp = wPresence.get(word)!
				let a = 0
				let wCount = 0
				for (let i = 0; i < N; i++) {
					if (wp[i]) wCount++
					if (fp[i] && wp[i]) a++
				}
				const b = fCount - a
				const c = wCount - a
				const d = N - a - b - c
				const exp = (fCount * wCount) / N
				const phi = (a * d - b * c) / Math.sqrt(fCount * (N - fCount) * wCount * (N - wCount) || 1)
				hits.push({ vf: features[fi]!, word, a, exp, phi, p: fisher(a, b, c, d) })
			}
		}
		return hits
	}

	const observed = bh(testAll(pages.map((p) => p.vf)))
	const hitsAtQ = observed.filter((h) => (h.q ?? 1) <= qThresh).length
	console.log("\nvf".padEnd(27), "token".padEnd(12), "a/exp".padEnd(12), "phi".padEnd(7), "p".padEnd(10), "q")
	for (const h of observed.slice(0, topN))
		console.log(
			h.vf.padEnd(27),
			h.word.padEnd(12),
			`${h.a}/${h.exp.toFixed(1)}`.padEnd(12),
			h.phi.toFixed(2).padEnd(7),
			h.p.toExponential(2).padEnd(10),
			(h.q ?? 1).toFixed(3),
		)
	console.log(`\nhits at q<=${qThresh}: ${hitsAtQ}`)

	if (perm > 0) {
		const vfSets = pages.map((p) => p.vf)
		let geHits = 0
		let sum = 0
		for (let r = 0; r < perm; r++) {
			const idx = [...Array(N).keys()]
			for (let i = N - 1; i > 0; i--) {
				const j = (i * 2654435761 + r * 40503 + 12345) % (i + 1)
				;[idx[i], idx[j]] = [idx[j]!, idx[i]!]
			}
			const h = bh(testAll(idx.map((i) => vfSets[i]!))).filter((x) => (x.q ?? 1) <= qThresh).length
			sum += h
			if (h >= hitsAtQ) geHits++
		}
		console.log(
			`permutation null (${perm}): mean hits=${(sum / perm).toFixed(1)}, ` +
				`P(null ≥ observed ${hitsAtQ}) = ${(geHits / perm).toFixed(3)}`,
		)
	}
}

for (const s of sections) analyze(s)
