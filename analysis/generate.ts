/**
 * Can a simple character Markov process reproduce Voynichese? Train an order-k char model
 * on the EVA corpus, sample a synthetic corpus of the same size, and compare statistics
 * side by side. If the synthetic text matches H2, word-length shape, affix inventory and
 * Zipf, then the manuscript text is reproducible by a cheap generator — concrete support
 * for "procedurally generated".
 *
 *   bun run generate.ts                 # order 3, whole corpus
 *   bun run generate.ts --order=2
 *   bun run generate.ts --hand=2        # train/compare on one scribe
 *   bun run generate.ts --section=herbal --show=20   # also print 20 sample words
 *
 * NB sampling uses Math.random (fine in a normal script). Each run differs slightly.
 */
import { loadZL } from "./zl.ts"

const args = process.argv.slice(2)
const order = Number(args.find((a) => a.startsWith("--order="))?.split("=")[1] ?? 3)
const section = args.find((a) => a.startsWith("--section="))?.split("=")[1]
const hand = args.find((a) => a.startsWith("--hand="))?.split("=")[1]
const show = Number(args.find((a) => a.startsWith("--show="))?.split("=")[1] ?? 0)
// self-citation overlay (Timm): with prob CITE copy-and-modify one of the last K words,
// with prob REPEAT just repeat the previous word verbatim, else generate with Markov.
const CITE = Number(args.find((a) => a.startsWith("--cite="))?.split("=")[1] ?? 0)
const REPEAT = Number(args.find((a) => a.startsWith("--repeat="))?.split("=")[1] ?? 0)
const K = 25

const zl = await loadZL()
const real: string[] = []
for (const f of zl.values()) {
	if (section && f.section !== section) continue
	if (hand && f.vars["H"] !== hand) continue
	real.push(...f.words)
}

// ---------- train order-k char Markov over words (^ pad, $ end) ----------
const PAD = "^".repeat(order)
const model = new Map<string, Map<string, number>>()
for (const w of real) {
	const s = PAD + w + "$"
	for (let i = order; i < s.length; i++) {
		const ctx = s.slice(i - order, i)
		const ch = s[i]!
		if (!model.has(ctx)) model.set(ctx, new Map())
		const m = model.get(ctx)!
		m.set(ch, (m.get(ch) ?? 0) + 1)
	}
}
function sampleNext(ctx: string): string {
	const m = model.get(ctx)
	if (!m) return "$"
	let total = 0
	for (const c of m.values()) total += c
	let r = Math.random() * total
	for (const [ch, c] of m) if ((r -= c) < 0) return ch
	return "$"
}
function genWord(seed = ""): string {
	let w = seed
	let ctx = (PAD + seed).slice(-order)
	for (let i = 0; i < 30; i++) {
		const ch = sampleNext(ctx)
		if (ch === "$") break
		w += ch
		ctx = (ctx + ch).slice(-order)
	}
	return w
}
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!
// Grammar-preserving citation: sometimes copy verbatim, else keep a prefix of the source
// word and re-grow the tail with the SAME Markov model (stays valid Voynichese, shares a stem).
function mutate(w: string): string {
	if (w.length <= 2 || Math.random() < 0.4) return w // verbatim copy
	const cut = 1 + Math.floor(Math.random() * (w.length - 1))
	return genWord(w.slice(0, cut))
}
const gen: string[] = []
for (let n = 0; n < real.length; n++) {
	let w: string
	const recent = gen.slice(-K)
	if (REPEAT > 0 && gen.length && Math.random() < REPEAT) {
		w = gen[gen.length - 1]! // verbatim repeat of previous
	} else if (CITE > 0 && recent.length && Math.random() < CITE) {
		w = mutate(pick(recent)) // copy-and-modify a recent word
	} else {
		w = genWord()
	}
	if (w.length > 0) gen.push(w)
}

// ---------- metrics ----------
function condEntropy(words: string[], k: number): number {
	const text = words.join(" ")
	const ctx = new Map<string, Map<string, number>>()
	const tot = new Map<string, number>()
	for (let i = k - 1; i < text.length; i++) {
		const c = text.slice(i - (k - 1), i)
		const x = text[i]!
		;(ctx.get(c) ?? ctx.set(c, new Map()).get(c)!).set(x, (ctx.get(c)!.get(x) ?? 0) + 1)
		tot.set(c, (tot.get(c) ?? 0) + 1)
	}
	const T = text.length - (k - 1)
	let H = 0
	for (const [c, m] of ctx) {
		const ct = tot.get(c)!
		let h = 0
		for (const n of m.values()) {
			const p = n / ct
			h -= p * Math.log2(p)
		}
		H += (ct / T) * h
	}
	return H
}
function lenStats(words: string[]) {
	const lens = words.map((w) => w.length)
	const n = lens.length
	const mean = lens.reduce((a, b) => a + b, 0) / n
	const v = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / n
	return { mean, sd: Math.sqrt(v), varOverMean: v / mean }
}
function affixProfile(words: string[], side: "pre" | "suf", len: number): Map<string, number> {
	const m = new Map<string, number>()
	let t = 0
	for (const w of words) {
		if (w.length < len) continue
		const a = side === "pre" ? w.slice(0, len) : w.slice(-len)
		m.set(a, (m.get(a) ?? 0) + 1)
		t++
	}
	for (const [k, v] of m) m.set(k, v / t)
	return m
}
function cosine(a: Map<string, number>, b: Map<string, number>): number {
	const keys = new Set([...a.keys(), ...b.keys()])
	let dot = 0
	let na = 0
	let nb = 0
	for (const k of keys) {
		const x = a.get(k) ?? 0
		const y = b.get(k) ?? 0
		dot += x * y
		na += x * x
		nb += y * y
	}
	return dot / (Math.sqrt(na * nb) || 1)
}
function lev(a: string, b: string): number {
	const m = a.length
	const n = b.length
	if (!m) return n
	if (!n) return m
	let prev = Array.from({ length: n + 1 }, (_, j) => j)
	for (let i = 1; i <= m; i++) {
		const cur = [i]
		for (let j = 1; j <= n; j++)
			cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
		prev = cur
	}
	return prev[n]!
}
function selfCite(words: string[], K = 25): number {
	let s = 0
	let c = 0
	for (let i = 1; i < words.length; i++) {
		let best = 0
		for (let j = Math.max(0, i - K); j < i; j++) {
			const sim = 1 - lev(words[i]!, words[j]!) / Math.max(words[i]!.length, words[j]!.length, 1)
			if (sim > best) best = sim
		}
		s += best
		c++
	}
	return s / c
}
function repeat(words: string[]): number {
	let r = 0
	for (let i = 1; i < words.length; i++) if (words[i] === words[i - 1]) r++
	return r / (words.length - 1)
}
function zipf(words: string[]) {
	const f = new Map<string, number>()
	for (const w of words) f.set(w, (f.get(w) ?? 0) + 1)
	const types = f.size
	const hapax = [...f.values()].filter((c) => c === 1).length
	return { types, ttr: types / words.length, hapaxPct: (100 * hapax) / types }
}

// ---------- report ----------
const label = `${section ?? "all"}${hand ? ` hand${hand}` : ""}`
console.log(`real corpus: ${real.length} words  |  Markov order ${order}  |  ${label}`)
console.log(`generated:   ${gen.length} words\n`)

const rl = lenStats(real)
const gl = lenStats(gen)
const rz = zipf(real)
const gz = zipf(gen)
const sufR = affixProfile(real, "suf", 2)
const sufG = affixProfile(gen, "suf", 2)
const preR = affixProfile(real, "pre", 2)
const preG = affixProfile(gen, "pre", 2)

const row = (name: string, r: string | number, g: string | number) =>
	console.log(name.padEnd(28), String(r).padEnd(12), String(g))
console.log("metric".padEnd(28), "REAL".padEnd(12), "GENERATED")
console.log("-".repeat(52))
row("char H2 (bits)", condEntropy(real, 2).toFixed(2), condEntropy(gen, 2).toFixed(2))
row("char H3 (bits)", condEntropy(real, 3).toFixed(2), condEntropy(gen, 3).toFixed(2))
row("word len mean", rl.mean.toFixed(2), gl.mean.toFixed(2))
row("word len var/mean", rl.varOverMean.toFixed(2), gl.varOverMean.toFixed(2))
row("type/token ratio", rz.ttr.toFixed(3), gz.ttr.toFixed(3))
row("hapax % of types", rz.hapaxPct.toFixed(1), gz.hapaxPct.toFixed(1))
row("immediate-repeat %", (100 * repeat(real)).toFixed(2), (100 * repeat(gen)).toFixed(2))
row("self-citation", selfCite(real).toFixed(3), selfCite(gen).toFixed(3))
console.log("-".repeat(52))
console.log(`suffix(2) profile cosine real↔gen: ${cosine(sufR, sufG).toFixed(3)}  (1.0 = same inventory)`)
console.log(`prefix(2) profile cosine real↔gen: ${cosine(preR, preG).toFixed(3)}`)

if (show > 0) {
	console.log(`\n${show} sample generated words:`)
	console.log(
		Array.from({ length: show }, genWord)
			.filter(Boolean)
			.join(" "),
	)
}
