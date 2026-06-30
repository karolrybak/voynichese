/**
 * Word-structure / slot-grammar analysis — characterize the *generator*, and test whether
 * all 5 LFD scribal hands share the SAME word template (= a common "table"/method).
 *
 *   bun run wordstruct.ts                 # all + per hand
 *   bun run wordstruct.ts --section=herbal
 *
 * Reports per group:
 *  - positional char entropy H(char | index-in-word): if ≈ the H2 from textstats, the
 *    predictability is POSITIONAL → words are slot-templated (prefix·core·suffix).
 *  - dominant prefixes / suffixes and their token coverage (a small inventory covering most
 *    of the corpus = a finite generator).
 * Then a cross-hand cosine-similarity matrix of the suffix and prefix profiles: ~1.0 means
 * every scribe draws affixes in the same proportions = shared template.
 */
import { loadZL } from "./zl.ts"

const args = process.argv.slice(2)
const sectionFilter = args.find((a) => a.startsWith("--section="))?.split("=")[1]
const zl = await loadZL()

function streamFor(pred: (f: { vars: Record<string, string>; section: string }) => boolean): string[] {
	const out: string[] = []
	for (const f of zl.values()) {
		if (sectionFilter && f.section !== sectionFilter) continue
		if (pred(f)) out.push(...f.words)
	}
	return out
}

/** H(char | absolute index in word), in bits, weighted over all char positions. */
function positionalEntropy(words: string[]): number {
	const byPos = new Map<number, Map<string, number>>()
	const posTotal = new Map<number, number>()
	let total = 0
	for (const w of words)
		for (let i = 0; i < w.length; i++) {
			if (!byPos.has(i)) byPos.set(i, new Map())
			const m = byPos.get(i)!
			m.set(w[i]!, (m.get(w[i]!) ?? 0) + 1)
			posTotal.set(i, (posTotal.get(i) ?? 0) + 1)
			total++
		}
	let H = 0
	for (const [pos, m] of byPos) {
		const pt = posTotal.get(pos)!
		let h = 0
		for (const n of m.values()) {
			const p = n / pt
			h -= p * Math.log2(p)
		}
		H += (pt / total) * h
	}
	return H
}

/** Affix counts. side="pre" or "suf"; len = chars. */
function affixes(words: string[], side: "pre" | "suf", len: number): Map<string, number> {
	const m = new Map<string, number>()
	for (const w of words) {
		if (w.length < len) continue
		const a = side === "pre" ? w.slice(0, len) : w.slice(-len)
		m.set(a, (m.get(a) ?? 0) + 1)
	}
	return m
}
function topWithCoverage(m: Map<string, number>, total: number, k: number) {
	const sorted = [...m].sort((a, b) => b[1] - a[1])
	let cum = 0
	return sorted.slice(0, k).map(([a, c]) => {
		cum += c
		return { a, c, pct: (100 * c) / total, cumPct: (100 * cum) / total }
	})
}

function report(label: string, words: string[]) {
	if (words.length < 200) {
		console.log(`\n## ${label}: ${words.length} words — skip`)
		return
	}
	console.log(`\n## ${label}  (${words.length} words)`)
	console.log(`H(char|position) = ${positionalEntropy(words).toFixed(2)} bits  (compare to textstats H2 ~2.0)`)
	const pre2 = topWithCoverage(affixes(words, "pre", 2), words.length, 8)
	const suf2 = topWithCoverage(affixes(words, "suf", 2), words.length, 8)
	console.log("top prefixes(2): " + pre2.map((x) => `${x.a} ${x.pct.toFixed(0)}%`).join("  ") + `  [top8 cover ${pre2.at(-1)!.cumPct.toFixed(0)}%]`)
	console.log("top suffixes(2): " + suf2.map((x) => `${x.a} ${x.pct.toFixed(0)}%`).join("  ") + `  [top8 cover ${suf2.at(-1)!.cumPct.toFixed(0)}%]`)
}

// ---------- per-group reports ----------
console.log(sectionFilter ? `section=${sectionFilter}` : "all sections")
report("ALL", streamFor(() => true))
const hands = ["1", "2", "3", "4", "5"]
for (const h of hands) report(`Hand ${h}`, streamFor((f) => f.vars["H"] === h))

// ---------- cross-hand affix-profile similarity ----------
function cosine(a: Map<string, number>, b: Map<string, number>, keys: string[]): number {
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
function norm(m: Map<string, number>): Map<string, number> {
	const t = [...m.values()].reduce((s, x) => s + x, 0) || 1
	return new Map([...m].map(([k, v]) => [k, v / t]))
}

function crossHand(side: "pre" | "suf", len: number, k: number) {
	const handStreams = hands.map((h) => streamFor((f) => f.vars["H"] === h))
	const profiles = handStreams.map((s) => (s.length >= 200 ? norm(affixes(s, side, len)) : null))
	// shared key set = union of each hand's top-k affixes
	const keys = new Set<string>()
	for (const p of profiles) if (p) for (const { a } of topWithCoverage(p, 1, k)) keys.add(a)
	const keyArr = [...keys]
	console.log(`\n=== cross-hand ${side}fix(${len}) profile cosine (1.0 = identical inventory) ===`)
	console.log("     " + hands.map((h) => "H" + h).join("    "))
	for (let i = 0; i < hands.length; i++) {
		const row = [`H${hands[i]} `]
		for (let j = 0; j < hands.length; j++) {
			const pi = profiles[i]
			const pj = profiles[j]
			row.push(pi && pj ? cosine(pi, pj, keyArr).toFixed(2) : " -- ")
		}
		console.log(row.join("  "))
	}
}
crossHand("suf", 2, 10)
crossHand("pre", 2, 10)
