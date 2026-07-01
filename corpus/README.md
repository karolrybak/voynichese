# Synthetic Voynich-like corpora

Two machine-generated text corpora (200,000 "words" each) that reproduce the statistical
profile of Voynichese. Provided for anyone who wants to run their own analysis. **These are
synthetic** — not the manuscript text.

| file | generator |
|------|-----------|
| `voynich-like-markov.txt` | order-3 character Markov model + ~15% self-citation overlay (the model that matches the real corpus on all metrics) |
| `voynich-like-volvelle.txt` | 3-ring "volvelle" with *independent* rings (positional slot device) — deliberately the weaker model: matches word length & affix inventory but over-produces character transitions |

**Format:** plain UTF-8, space-separated EVA-style words, ~12 words per line (mimicking
manuscript lines). Tokenize on whitespace.

**How they were made** (from `../analysis/`):

```bash
node generate.ts --order=3 --cite=0.15 --n=200000 --dump=../corpus/voynich-like-markov.txt
node volvelle.ts --n=200000 --dump=../corpus/voynich-like-volvelle.txt
```

**Why they exist.** The whole point of the project is that Voynichese is reproducible by a
cheap, meaning-free procedure. Compare these against the real transliteration and you should
find matching character entropy, word-length distribution, affix inventory and Zipf for the
Markov corpus; the volvelle corpus intentionally diverges on conditional entropy, showing the
device's rings must be *coupled* (geared), not independent. See the main `README.md`.

**The real manuscript text** is not redistributed here; get the Zandbergen–Landini or other
transliterations from <https://www.voynich.nu/data/>.
