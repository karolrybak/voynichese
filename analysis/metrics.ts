/**
 * Shared metric functions — the SAME code applied to Voynich and to natural-language
 * reference corpora, so the comparison is apples-to-apples.
 */

/** Conditional char entropy H(x_n | previous k-1 chars), bits/char, over words joined by space. */
export function condEntropy(words: string[], k: number): number {
	const text = words.join(" ")
	const ctx = new Map<string, Map<string, number>>()
	const tot = new Map<string, number>()
	for (let i = k - 1; i < text.length; i++) {
		const c = text.slice(i - (k - 1), i)
		const x = text[i]!
		if (!ctx.has(c)) ctx.set(c, new Map())
		ctx.get(c)!.set(x, (ctx.get(c)!.get(x) ?? 0) + 1)
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

export function lengthStats(words: string[]) {
	const lens = words.map((w) => w.length)
	const n = lens.length
	const mean = lens.reduce((a, b) => a + b, 0) / n
	const v = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / n
	return { mean, sd: Math.sqrt(v), varOverMean: v / mean }
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
export const sim = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1)

/** Mean over tokens of max similarity to any of the K preceding tokens. */
export function selfCite(words: string[], K = 25): number {
	let s = 0
	let c = 0
	for (let i = 1; i < words.length; i++) {
		let best = 0
		for (let j = Math.max(0, i - K); j < i; j++) {
			const v = sim(words[i]!, words[j]!)
			if (v > best) best = v
		}
		s += best
		c++
	}
	return c ? s / c : 0
}

export function shuffled(words: string[], seed = 1): string[] {
	const a = [...words]
	for (let i = a.length - 1; i > 0; i--) {
		const j = (i * 2654435761 + seed * 40503 + 12345) % (i + 1)
		;[a[i], a[j]] = [a[j]!, a[i]!]
	}
	return a
}

export function repeatRate(words: string[]): number {
	let r = 0
	for (let i = 1; i < words.length; i++) if (words[i] === words[i - 1]) r++
	return r / (words.length - 1)
}

export function zipf(words: string[]) {
	const f = new Map<string, number>()
	for (const w of words) f.set(w, (f.get(w) ?? 0) + 1)
	const types = f.size
	const hapax = [...f.values()].filter((c) => c === 1).length
	return { types, ttr: types / words.length, hapaxPct: (100 * hapax) / types }
}

export function affixProfile(words: string[], side: "pre" | "suf", len: number): Map<string, number> {
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
