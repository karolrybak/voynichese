/**
 * Calibration + robustness in one table.
 *
 * Runs the identical metric suite on:
 *   - three Voynich transliterations (ZL/EVA, Takahashi/EVA, GC/v101) — robustness: the
 *     findings must not be an artefact of the EVA alphabet;
 *   - three natural languages (Latin, German, English) — calibration: real reference values.
 *
 *   node compare.ts
 *
 * Key discriminators: H1−H2 "drop" (rigid sub-word structure → big drop), word-length
 * var/mean (<1 binomial/under-dispersed = generated; >1 = natural), and self-citation lift
 * over the shuffled baseline.
 */
import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { loadIVTFF } from "./zl.ts"
import { condEntropy, lengthStats, selfCite, shuffled, repeatRate, zipf } from "./metrics.ts"

const HERE = import.meta.dirname
const ivtff = (f: string) => join(HERE, "..", "ivtff", f)
const ref = (f: string) => join(HERE, "..", "ref", f)

async function voynichWords(file: string): Promise<string[]> {
	const folios = await loadIVTFF(ivtff(file))
	const out: string[] = []
	for (const f of folios.values()) out.push(...f.words)
	return out
}
async function textWords(file: string): Promise<string[]> {
	const raw = await readFile(ref(file), "utf8").catch(() => "")
	return (raw.toLowerCase().match(/[\p{L}]+/gu) ?? []) as string[]
}

const corpora: { name: string; words: string[] }[] = [
	{ name: "Voynich ZL/EVA", words: await voynichWords("ZL3b-n.txt") },
	{ name: "Voynich Takahashi", words: await voynichWords("IT2a-n.txt") },
	{ name: "Voynich v101/GC", words: await voynichWords("GC2a-n.txt") },
	{ name: "Latin (Caesar)", words: await textWords("latin.txt") },
	{ name: "German (Faust)", words: await textWords("german.txt") },
	{ name: "English", words: await textWords("english.txt") },
]

const pad = (s: string | number, n: number) => String(s).padEnd(n)
console.log(
	pad("corpus", 20),
	pad("words", 8),
	pad("H1", 6),
	pad("H2", 6),
	pad("drop", 6),
	pad("len", 6),
	pad("var/mn", 7),
	pad("ttr", 6),
	pad("selfcite", 18),
	"rep%",
)
console.log("-".repeat(100))
for (const { name, words } of corpora) {
	if (words.length < 500) {
		console.log(pad(name, 20), pad(words.length, 8), "(too small)")
		continue
	}
	const H1 = condEntropy(words, 1)
	const H2 = condEntropy(words, 2)
	const ls = lengthStats(words)
	const z = zipf(words)
	const sc = selfCite(words)
	const scShuf = selfCite(shuffled(words))
	console.log(
		pad(name, 20),
		pad(words.length, 8),
		pad(H1.toFixed(2), 6),
		pad(H2.toFixed(2), 6),
		pad((H1 - H2).toFixed(2), 6),
		pad(ls.mean.toFixed(2), 6),
		pad(ls.varOverMean.toFixed(2), 7),
		pad(z.ttr.toFixed(3), 6),
		pad(`${sc.toFixed(3)}/${scShuf.toFixed(3)} (+${(sc - scShuf).toFixed(3)})`, 18),
		(100 * repeatRate(words)).toFixed(2),
	)
}
console.log(
	"\ndrop = H1−H2 (rigid sub-word structure → large). var/mn <1 = under-dispersed/binomial (generated); >1 = natural.",
)
console.log("selfcite = real/shuffled (+lift). Voynich should show low H2/large drop, var/mn<1, positive lift.")
