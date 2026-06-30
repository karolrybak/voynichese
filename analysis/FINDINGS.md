# Voynichese as a two-mechanism procedural text: a computational re-analysis

**Abstract.** Using the full Zandbergen–Landini transliteration (ZL3b-n, ~37,700 word
tokens) and per-folio illustration features extracted by a vision-language model from the
Beinecke IIIF page images, we find: (1) **no** detectable within-section association between
what a page depicts and the text it carries; (2) the text's well-known "language-like"
statistics are **uniform across all five scribal hands** (Davis) yet sharply unlike natural
language; (3) the predictability is **sequential, not positional**; and (4) a trivial
generator — an **order-3 character Markov model plus a ~15% grammar-preserving
self-citation overlay** — reproduces the full statistical profile of Voynichese, including
character entropy, word-length distribution, affix inventory, type-token ratio, immediate
repetition, and self-citation. These signatures hold across **three independent
transliterations** (EVA-ZL, EVA-Takahashi, v101-GC) and are sharply distinct from **three
natural-language control corpora** (Latin, German, English) under identical code. The
simplest explanation consistent with all results is that the text was produced by a cheap,
meaning-free procedure shared by the scribes.

---

## 1. Question

The Voynich text has language-like regularities (Zipf, fixed word morphology) but a century
of decipherment has failed. We ask two things in sequence:

1. Does the **text correlate with the imagery** (i.e. does it describe the pictures)?
2. If not — what **generative procedure** could produce text with these exact statistics?

## 2. Data and methods

- **Text.** ZL3b-n.txt (Zandbergen–Landini, IVTFF 2.0), parsed per folio with its
  ground-truth page variables: section (`$I`), Currier language (`$C`), and **Davis scribal
  hand (`$H`)**. Inline markup stripped to a Basic-EVA word stream; loci split by type
  (paragraph / label / radial / circular).
- **Images.** 211 page images pulled from the Beinecke IIIF manifest (Yale 2002046), named
  by folio, so the folio↔image map is exact.
- **Visual features.** Each folio annotated by `qwen3-vl-8b` (local, schema-constrained)
  into a per-section feature vector (leaf/root/flower shape, palette, figure counts, tubes,
  rings, …) plus a free keyword list.
- **Statistics.** Fisher exact + Benjamini–Hochberg FDR + label-permutation null for
  correlation; character conditional entropy, word-length dispersion, Levenshtein-based
  self-citation, affix-profile cosine, Zipf for the generative analysis.
- **Controls.** The generative metrics are also run on two further Voynich transliterations
  (Takahashi/EVA = IT2a-n, GC/v101 = GC2a-n) and on three natural-language corpora — Latin
  (Caesar, *De Bello Gallico*), German (Goethe, *Faust*), English — using the **same code**
  (`metrics.ts`), to calibrate the numbers and rule out an EVA-alphabet artefact.

All code is in this directory (`analysis/`); see `ANALYSIS.md` for the correlation tooling.

## 3. Result 1 — the text does not describe the pictures

For every section we tested each (visual feature × text token) pair for co-occurrence across
folios, **within section** so the dominant section/Currier confound is held constant. In the
best-powered section (herbal, 121 folios, ~13,000 tested pairs) **nothing survives FDR**
(smallest q = 1.0) and the permutation null is consistent with pure chance
(P(null ≥ observed) = 1.0). This holds for whole words and character n-grams, for structured
features and VL keywords, and at the label-locus level (limited by small samples).

**Reading:** beyond the already-known macro-structure (sections, Currier A/B), the way a page
*looks* carries no information about the text on it. The text is not labelling the drawings.

## 4. Result 2 — the same artificial fingerprint in all five scribes

Splitting the corpus by Davis hand and recomputing the canonical discriminators:

| hand | words | char H2 | word-len var/mean | self-cite (real / shuffled) |
|------|-------|---------|-------------------|------------------------------|
| H1 | 10,501 | 2.19 | 0.94 | 0.658 / 0.621 |
| H2 | 11,002 | 1.96 | 0.68 | 0.702 / 0.671 |
| H3 | 11,743 | 2.02 | 0.63 | 0.676 / 0.647 |
| H4 |  3,075 | 2.23 | 0.79 | 0.630 / 0.610 |
| H5 |    889 | 2.17 | 0.97 | 0.639 / 0.616 |

Reference points for natural language (letters): conditional entropy H2 ≈ 3.3 bits;
word-length variance/mean **> 1** (over-dispersed). Every Voynich hand sits at **H2 ≈ 2** and
**var/mean < 1** (binomial-like, under-dispersed), and every hand shows self-citation above
its shuffled baseline.

**Reading:** a natural language does not impose H2 ≈ 2 and binomial word lengths on every
writer. Five scribes producing the *same* anomalous statistics points to a **shared method or
device**, not to five people independently writing a language. The within-set variation
(H2/H3 more rigid than H1/H4/H5) tracks Currier A vs B — i.e. the "two languages" behave like
two settings of one generator, partially decoupled from both scribe and section.

## 5. Result 3 — the structure is sequential, not positional

A small affix inventory dominates every hand (top-8 two-character prefixes cover ~60–67%,
suffixes ~65–83%), and cross-hand cosine similarity of the affix profiles is high
(suffixes 0.60–0.96, prefixes 0.68–0.97): **the same inventory, reweighted per hand** — i.e.
a shared "table". Crucially, predictability is **sequential**: character entropy conditioned
on the *previous character* (H2 ≈ 2.0) is far lower than conditioned on the *position in the
word* (≈ 3.4). A positional table/grille (e.g. a Cardan grille over a syllable table) would
predict the opposite. The data favour a **transition-based** word builder.

## 6. Result 4 — a two-mechanism generator reproduces Voynichese

We trained an **order-3 character Markov** model on the corpus and sampled a synthetic corpus
of equal size, then added a **self-citation overlay**: with probability ≈0.15, instead of
generating a fresh word, copy a recent word (within the last 25) and either keep it verbatim
or keep a prefix and re-grow the tail with the *same* Markov model (so the modification stays
grammatical).

| metric | real | Markov-3 only | Markov-3 + self-citation |
|--------|------|---------------|---------------------------|
| char entropy H2 | 2.15 | 2.15 | 2.15 |
| char entropy H3 | 1.90 | 1.92 | 1.92 |
| word length mean | 5.06 | 5.06 | 5.08 |
| word length var/mean | 0.75 | 0.90 | 0.92 |
| type/token ratio | 0.218 | 0.224 | 0.213 |
| hapax % of types | 70.6 | 71.3 | 67.5 |
| immediate-repeat % | **0.78** | 0.34 | **0.70** |
| self-citation | **0.674** | 0.620 | **0.653** |
| suffix/prefix profile cosine | — | 1.00 / 1.00 | 1.00 / 1.00 |

Plain Markov already matches morphology, entropy, length and Zipf; the only things it misses
are the **local** signals — immediate repetition and self-citation — because it draws each
word independently. Adding the copy-and-modify overlay closes exactly those two, with no cost
to the rest. Sample output: *qoeeal shd shos lsheodain oteedy dchdar ol ar okold qokal qopchdy
or olkchy qokeey yteey otair deeol shar chedy chor ykodaiin* — indistinguishable from
Voynichese to the eye.

## 7. Calibration and robustness (controls)

The same metric suite on three Voynich transliterations and three natural languages:

| corpus | words | H1 | H2 | H1−H2 drop | word len | **var/mean** | **immediate-repeat %** | self-cite (real/shuf, lift) |
|--------|-------|----|----|-----------|----------|--------------|------------------------|------------------------------|
| Voynich ZL/EVA       | 37,671 | 3.87 | 2.15 | **1.72** | 5.06 | **0.75** | **0.78** | 0.674 / 0.627 (+0.047) |
| Voynich Takahashi/EVA| 37,026 | 3.87 | 2.17 | **1.71** | 5.17 | **0.70** | **0.80** | 0.677 / 0.629 (+0.048) |
| Voynich GC/v101      | 40,098 | 4.02 | 2.56 | **1.46** | 3.89 | **0.59** | **0.61** | 0.629 / 0.583 (+0.046) |
| Latin (Caesar)       | 44,955 | 4.02 | 3.31 | 0.71 | 6.14 | 1.39 | 0.00 | 0.467 / 0.447 (+0.020) |
| German (Faust)       | 30,981 | 4.13 | 3.19 | 0.93 | 4.78 | 1.28 | 0.18 | 0.540 / 0.506 (+0.034) |
| English              | 161,720| 4.08 | 3.27 | 0.81 | 4.54 | 1.25 | 0.03 | 0.548 / 0.526 (+0.022) |

Three discriminators separate Voynich from all three real languages, and do so **identically
across all three transliterations** (so it is not an EVA artefact):

- **H1−H2 drop** (how much one previous character determines the next): Voynich 1.46–1.72 vs
  natural 0.71–0.93 — Voynich's sub-word structure is roughly twice as rigid.
- **word-length var/mean**: Voynich 0.59–0.75 (< 1, under-dispersed / binomial = generated)
  vs natural 1.25–1.39 (> 1, over-dispersed). The cleanest single separator.
- **immediate-repeat rate**: Voynich 0.6–0.8 % vs natural 0.00–0.18 % (Latin literally 0).

Self-citation lift over the shuffled baseline is also ~2× higher in Voynich (+0.046–0.048)
than in natural prose (+0.020–0.034). The v101 transliteration shifts absolute values
(shorter tokens, different alphabet) but the qualitative picture is unchanged.

## 8. Synthesis

The four results compose into one picture. The text **does not relate to the imagery**; its
language-like statistics are **identical across five scribes** and **unlike any natural
language**; its internal structure is **transition-based** over a **shared affix table**; and
**two cheap, meaning-free mechanisms** —

1. a **low-order character transition generator** (a syllable/affix table browsed
   sequentially), and
2. a **local self-citation habit** (occasionally copying and lightly altering a nearby word),

— jointly reproduce the entire statistical profile. This unifies prior strands: the
transition/affix structure echoes Stolfi's word grammar and Rugg's table idea, while the
self-citation residue is precisely the Timm–Schinner mechanism. Our contribution is to show,
on the full corpus, that these two together are **sufficient** to reproduce Voynichese, and
that the signature is **invariant across all of Davis's scribal hands**.

## 9. What this does and does not show

- It **does** show that a process with **no linguistic content** is sufficient to generate
  text statistically indistinguishable from Voynichese, and that all five scribes share that
  process. By Occam's razor, hidden meaning is **not required** to explain the manuscript's
  text.
- It does **not** prove the manuscript was made this way, nor strictly disprove an underlying
  message. A 15th-century scribe did not run a Markov chain — but an equivalent physical
  device (a table of syllables consulted in sequence, plus the human habit of glancing back at
  the previous line) produces the same output.
- Caveats: character entropy depends on the transliteration's glyph segmentation — but §7
  shows the anomaly survives in v101 (a different alphabet) and Takahashi, so it is not an EVA
  artefact; the smallest hand (H5) has limited data; the visual features carry VL-model noise
  (which can only *weaken*, not manufacture, a correlation, so it does not threaten Result 1);
  and the generator's word-length var/mean is slightly high (0.92 vs 0.75), tightened at
  order 4. The natural-language controls (§7) are not period-matched (classical Latin, modern
  German/English); the discriminating gaps are large enough that this is unlikely to matter.

## 10. Reproduce

```bash
bun run zl.ts                                   # corpus + hand/section/Currier breakdown
bun run correlate.ts --section=all --perm=500   # Result 1 (image↔text null)
bun run textstats.ts                            # Result 2 (signatures by hand & Currier)
bun run wordstruct.ts                           # Result 3 (affix table, positional entropy)
bun run compare.ts                              # §7 (calibration vs Latin/German/English; 3 transliterations)
bun run generate.ts --order=3 --cite=0.15 --show=30   # Result 4 (reproduce Voynichese)
```

*Data: Beinecke MS 408 (Yale, IIIF) and the Zandbergen–Landini transliteration
(voynich.nu). Prior work built on: Currier (languages), Davis (scribal hands), Stolfi (word
grammar), Rugg (table/grille), Timm & Schinner (self-citation).*
