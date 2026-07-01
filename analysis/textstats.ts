/**
 * Is Voynichese procedurally GENERATED rather than a natural language / simple cipher?
 * Computes the canonical discriminators on the ZL EVA corpus and compares Currier A vs B
 * vs a shuffled control. No images involved — pure text, full 37k-word corpus.
 *
 *   node textstats.ts                # all folios, split by Currier language
 *   node textstats.ts --section=herbal
 *
 * Tests:
 *  1. Character conditional entropy h1/h2/h3 (bits/char). Natural langs ~h2 3–3.5; Voynich
 *     is famously low (~2) → rigid sub-word structure, predictable next char.
 *  2. Word-length distribution: mean/sd + how close to a binomial (generated) vs the
 *     skewed shape of real languages.
 *  3. Self-citation (Timm): mean similarity of each word to the nearest of the K preceding
 *     words, vs the same on a shuffled stream. Real Voynich >> shuffled = copy-and-modify.
 *  4. Immediate-repeat rate: P(word == previous word). Natural prose ~0; Voynich elevated.
 */
import { loadZL } from "./zl.ts"

const args = process.argv.slice(2)
const sectionFilter = args.find((a) => a.startsWith("--section="))?.split("=")[1]

const zl = await loadZL()

/** Build a word stream for a predicate over folios. */
function streamFor(pred: (f: { vars: Record<string, string>; section: string }) => boolean): string[] {
	const out: string[] = []
	for (const f of zl.values()) {
		if (sectionFilter && f.section !== sectionFilter) continue
		if (!pred(f)) continue
		out.push(...f.words)
	}
	return out
}

// ---------- 1. character conditional entropy ----------
/** Conditional entropy H(x_n | x_{n-1..n-k+1}) in bits/char over the char stream
 *  (words joined by a space char so boundaries count). k=1 → unigram H1. */
function condEntropy(words: string[], k: number): number {
	const text = words.join(" ")
	const ctx = new Map<string, Map<string, number>>()
	const ctxTotal = new Map<string, number>()
	for (let i = k - 1; i < text.length; i++) {
		const c = text.slice(i - (k - 1), i) // k-1 chars of context
		const x = text[i]!
		if (!ctx.has(c)) ctx.set(c, new Map())
		const m = ctx.get(c)!
		m.set(x, (m.get(x) ?? 0) + 1)
		ctxTotal.set(c, (ctxTotal.get(c) ?? 0) + 1)
	}
	const total = text.length - (k - 1)
	let H = 0
	for (const [c, m] of ctx) {
		const cTot = ctxTotal.get(c)!
		const pc = cTot / total
		let hGivenC = 0
		for (const n of m.values()) {
			const p = n / cTot
			hGivenC -= p * Math.log2(p)
		}
		H += pc * hGivenC
	}
	return H
}

// ---------- 2. word-length distribution ----------
function lengthStats(words: string[]) {
	const lens = words.map((w) => w.length)
	const n = lens.length
	const mean = lens.reduce((a, b) => a + b, 0) / n
	const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / n
	// binomial would have variance = mean*(1 - mean/maxLen); compare var/mean (1.0 ≈ Poisson-ish,
	// <1 ≈ binomial/under-dispersed = rigid; real languages are over-dispersed, >1)
	const hist = new Map<number, number>()
	for (const l of lens) hist.set(l, (hist.get(l) ?? 0) + 1)
	return { n, mean, sd: Math.sqrt(variance), varOverMean: variance / mean, hist }
}

// ---------- 3. self-citation (Timm) ----------
function lev(a: string, b: string): number {
	const m = a.length
	const n = b.length
	if (!m) return n
	if (!n) return m
	let prev = Array.from({ length: n + 1 }, (_, j) => j)
	for (let i = 1; i <= m; i++) {
		const cur = [i]
		for (let j = 1; j <= n; j++) {
			cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
		}
		prev = cur
	}
	return prev[n]!
}
const sim = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1)

/** Mean over tokens of the MAX similarity to any of the K preceding tokens. */
function selfCitation(words: string[], K = 25): number {
	let sum = 0
	let cnt = 0
	for (let i = 1; i < words.length; i++) {
		let best = 0
		for (let j = Math.max(0, i - K); j < i; j++) {
			const s = sim(words[i]!, words[j]!)
			if (s > best) best = s
		}
		sum += best
		cnt++
	}
	return cnt ? sum / cnt : 0
}

/** Deterministic Fisher-Yates (seeded by index, no Math.random) for the shuffled control. */
function shuffled(words: string[], seed = 1): string[] {
	const a = [...words]
	for (let i = a.length - 1; i > 0; i--) {
		const j = (i * 2654435761 + seed * 40503 + 12345) % (i + 1)
		;[a[i], a[j]] = [a[j]!, a[i]!]
	}
	return a
}

function repeatRate(words: string[]): number {
	let r = 0
	for (let i = 1; i < words.length; i++) if (words[i] === words[i - 1]) r++
	return r / (words.length - 1)
}

// ---------- report ----------
function report(label: string, words: string[]) {
	if (words.length < 200) {
		console.log(`\n## ${label}: only ${words.length} words — skipping`)
		return
	}
	const ls = lengthStats(words)
	const shuf = shuffled(words)
	console.log(`\n## ${label}  (${words.length} words, ${new Set(words).size} types)`)
	console.log(`char entropy  H1=${condEntropy(words, 1).toFixed(2)}  H2=${condEntropy(words, 2).toFixed(2)}  H3=${condEntropy(words, 3).toFixed(2)}  bits/char`)
	console.log(`word length   mean=${ls.mean.toFixed(2)}  sd=${ls.sd.toFixed(2)}  var/mean=${ls.varOverMean.toFixed(2)}  (real langs >1; rigid <1)`)
	const top = [...ls.hist].sort((a, b) => a[0] - b[0])
	console.log(`  length hist: ${top.map(([l, c]) => `${l}:${((100 * c) / ls.n).toFixed(0)}%`).join(" ")}`)
	console.log(`self-citation max-sim to prev 25:  real=${selfCitation(words).toFixed(3)}  shuffled=${selfCitation(shuf).toFixed(3)}  (real≫shuffled = copy-and-modify)`)
	console.log(`immediate-repeat rate: real=${(100 * repeatRate(words)).toFixed(2)}%  shuffled=${(100 * repeatRate(shuf)).toFixed(2)}%`)
}

console.log(sectionFilter ? `section=${sectionFilter}` : "all sections")
console.log("\n===== by Currier language =====")
report("Currier A", streamFor((f) => f.vars["C"] === "1"))
report("Currier B", streamFor((f) => f.vars["C"] === "2"))
console.log("\n===== by LFD scribal hand =====")
for (const h of ["1", "2", "3", "4", "5"]) report(`Hand ${h}`, streamFor((f) => f.vars["H"] === h))
report("ALL", streamFor(() => true))
