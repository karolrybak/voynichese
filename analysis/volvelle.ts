/**
 * Does a 3-ring volvelle (positional slot device) reproduce Voynichese as well as the
 * sequential Markov model? Contrasts:
 *   - REAL corpus
 *   - MARKOV: order-3 char model (each char depends on previous chars = sequential)
 *   - VOLVELLE: learn a prefix ring, a core ring, a suffix ring; assemble a word by drawing
 *     each ring INDEPENDENTLY (positional, no memory between rings = a physical grille/wheel)
 *
 *   bun run volvelle.ts            # comparison table + sample volvelle words
 *   bun run volvelle.ts --dump=volvelle_out.txt
 *
 * If VOLVELLE matches on word length / affix inventory but its char entropy H2 is too HIGH,
 * that means independent slots allow character transitions the real text forbids → the real
 * device needs *coupled* rings (geared wheels), i.e. structure is sequential not merely slotted.
 */
import { loadZL } from "./zl.ts"
import { condEntropy, lengthStats, selfCite, shuffled, repeatRate, zipf, affixProfile } from "./metrics.ts"

const args = process.argv.slice(2)
const dumpPath = args.find((a) => a.startsWith("--dump="))?.split("=")[1]

const zl = await loadZL()
const real: string[] = []
for (const f of zl.values()) real.push(...f.words)
const N = real.length

// ---------- MARKOV (order 3) ----------
const order = 3
const PAD = "^".repeat(order)
const mk = new Map<string, Map<string, number>>()
for (const w of real) {
	const s = PAD + w + "$"
	for (let i = order; i < s.length; i++) {
		const c = s.slice(i - order, i)
		if (!mk.has(c)) mk.set(c, new Map())
		mk.get(c)!.set(s[i]!, (mk.get(c)!.get(s[i]!) ?? 0) + 1)
	}
}
function sampleMap<T extends string>(m: Map<T, number>): T {
	let t = 0
	for (const v of m.values()) t += v
	let r = Math.random() * t
	for (const [k, v] of m) if ((r -= v) < 0) return k
	return [...m.keys()][0]!
}
function markovWord(): string {
	let ctx = PAD
	let w = ""
	for (let i = 0; i < 30; i++) {
		const ch = sampleMap(mk.get(ctx) ?? new Map([["$", 1]]))
		if (ch === "$") break
		w += ch
		ctx = (ctx + ch).slice(-order)
	}
	return w
}

// ---------- VOLVELLE (3 independent rings) ----------
// Ring inventories learned by stripping the commonest prefixes/suffixes; the remainder is the
// core ring. Rings are then sampled independently (no coupling) — a pure positional device.
function topAffixes(side: "pre" | "suf", lens: number[], k: number): string[] {
	const counts = new Map<string, number>()
	for (const w of real)
		for (const L of lens) {
			if (w.length <= L) continue
			const a = side === "pre" ? w.slice(0, L) : w.slice(-L)
			counts.set(a, (counts.get(a) ?? 0) + 1)
		}
	return [...counts].sort((a, b) => b[1] - a[1]).slice(0, k).map(([a]) => a)
}
// longer affixes first so "aiin" wins over "in"
const PREFIXES = topAffixes("pre", [2, 1], 15).sort((a, b) => b.length - a.length)
const SUFFIXES = topAffixes("suf", [3, 2, 1], 18).sort((a, b) => b.length - a.length)

function segment(w: string): { p: string; c: string; s: string } {
	let rest = w
	let p = ""
	for (const pre of PREFIXES)
		if (rest.length > pre.length && rest.startsWith(pre)) {
			p = pre
			rest = rest.slice(pre.length)
			break
		}
	let s = ""
	for (const suf of SUFFIXES)
		if (rest.length > suf.length && rest.endsWith(suf)) {
			s = suf
			rest = rest.slice(0, -suf.length)
			break
		}
	return { p, c: rest, s }
}
const preRing = new Map<string, number>()
const coreRing = new Map<string, number>()
const sufRing = new Map<string, number>()
for (const w of real) {
	const { p, c, s } = segment(w)
	preRing.set(p, (preRing.get(p) ?? 0) + 1)
	coreRing.set(c, (coreRing.get(c) ?? 0) + 1)
	sufRing.set(s, (sufRing.get(s) ?? 0) + 1)
}
const volvelleWord = () => sampleMap(preRing) + sampleMap(coreRing) + sampleMap(sufRing)

const NGEN = Number(args.find((a) => a.startsWith("--n="))?.split("=")[1]) || N
const markov = Array.from({ length: NGEN }, markovWord).filter(Boolean)
const volvelle = Array.from({ length: NGEN }, volvelleWord).filter(Boolean)

// ---------- compare ----------
function cosine(a: Map<string, number>, b: Map<string, number>): number {
	const keys = new Set([...a.keys(), ...b.keys()])
	let d = 0
	let na = 0
	let nb = 0
	for (const k of keys) {
		const x = a.get(k) ?? 0
		const y = b.get(k) ?? 0
		d += x * y
		na += x * x
		nb += y * y
	}
	return d / (Math.sqrt(na * nb) || 1)
}
const sufReal = affixProfile(real, "suf", 2)
const preReal = affixProfile(real, "pre", 2)

function row(name: string, w: string[]) {
	const H2 = condEntropy(w, 2)
	const H3 = condEntropy(w, 3)
	const ls = lengthStats(w)
	const z = zipf(w)
	const sc = selfCite(w)
	const scs = selfCite(shuffled(w))
	const sufCos = cosine(affixProfile(w, "suf", 2), sufReal)
	const preCos = cosine(affixProfile(w, "pre", 2), preReal)
	console.log(
		name.padEnd(10),
		H2.toFixed(2).padEnd(6),
		H3.toFixed(2).padEnd(6),
		ls.mean.toFixed(2).padEnd(6),
		ls.varOverMean.toFixed(2).padEnd(7),
		z.ttr.toFixed(3).padEnd(6),
		`${sufCos.toFixed(2)}/${preCos.toFixed(2)}`.padEnd(10),
		`+${(sc - scs).toFixed(3)}`.padEnd(8),
		(100 * repeatRate(w)).toFixed(2),
	)
}
console.log(`rings learned: ${preRing.size} prefixes, ${coreRing.size} cores, ${sufRing.size} suffixes`)
console.log(`prefix ring: ${[...preRing].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k || "∅").join(" ")}`)
console.log(`suffix ring: ${[...sufRing].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k || "∅").join(" ")}\n`)
console.log("model".padEnd(10), "H2".padEnd(6), "H3".padEnd(6), "len".padEnd(6), "var/mn".padEnd(7), "ttr".padEnd(6), "suf/pre cos".padEnd(10), "selfcite".padEnd(8), "rep%")
console.log("-".repeat(78))
row("REAL", real)
row("MARKOV-3", markov)
row("VOLVELLE", volvelle)

console.log("\n25 volvelle words:", Array.from({ length: 25 }, volvelleWord).join(" "))
if (dumpPath) {
	const lines: string[] = []
	for (let i = 0; i < volvelle.length; i += 12) lines.push(volvelle.slice(i, i + 12).join(" "))
	await Bun.write(dumpPath, lines.join("\n") + "\n")
	console.log(`\ndumped ${volvelle.length} volvelle words → ${dumpPath}`)
}
