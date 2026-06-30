/**
 * Voynich page-annotation schema — single source of truth (arktype).
 *
 * Designed for *correlation*, not description: every field is a boolean, a small enum, or a
 * bucketed count, so each page becomes a clean, comparable feature vector. Open-vocabulary
 * text lives only in `free_tags` and is explicitly NOT part of the statistical vector.
 *
 * Two ways to drive the model:
 *   - per-section (preferred): pick the schema from the folio's ground-truth $I section
 *     (`schemaForSection`) so the model only fills relevant, dense features.
 *   - unified (map-free): one schema with every feature block optional (`VoynichPage`) —
 *     use before the folio→png map exists.
 *
 * `*JsonSchema` exports are what you send on the dyfuzor websocket `schema` field
 * (llama.cpp turns them into a generation grammar).
 */
import { scope, type, type Type } from "arktype"

const v = scope({
	// ---- shared vocabulary ----
	Confidence: "'high'|'medium'|'low'",
	Section:
		"'herbal'|'astronomical'|'cosmological'|'biological'|'pharmaceutical'|'zodiac'|'recipes'|'text_only'|'unknown'",
	/** Bucketed count — stabler under self-consistency and stronger statistically than raw ints. */
	CountBucket: "'0'|'1'|'2_5'|'6_20'|'20plus'",
	/** Voynich's limited pigment palette, as booleans (presence/absence per page). */
	Palette: {
		green: "boolean",
		blue: "boolean",
		red_brown: "boolean",
		ochre_yellow: "boolean",
		white: "boolean",
		ink_only: "boolean",
	},
	/** Present on every page regardless of section. */
	Core: {
		/** Model's own guess — cross-checked against ground-truth $I, NOT used as a feature. */
		predicted_section: "Section",
		confidence: "Confidence",
		/** false → damaged/blank/illegible; lets us drop guessed pages from the stats. */
		legible: "boolean",
		palette: "Palette",
	},

	// ---- per-section feature blocks ----
	HerbalFeatures: {
		leaf_shape: "'serrated'|'smooth'|'lobed'|'compound'|'elongated'|'needle'|'none'",
		leaf_arrangement: "'opposite'|'alternate'|'whorled'|'basal'|'unclear'",
		leaf_density: "'none'|'few_1_5'|'many_6_15'|'dense_16plus'",
		root_shape:
			"'bulbous'|'fibrous'|'taproot'|'split'|'human_like'|'animal_like'|'claw_like'|'geometric'|'none'",
		flower_present: "boolean",
		flower_count: "'0'|'1'|'2_3'|'4plus'",
		flower_color: "'green'|'blue'|'red_brown'|'ochre_yellow'|'white'|'none'",
		petal_count: "'na'|'1_4'|'5'|'6'|'7plus'|'composite'",
		stem: "'single'|'branched'",
		has_container: "boolean",
	},
	AstroFeatures: {
		central_icon: "'sun'|'moon'|'star'|'face'|'none'",
		has_face_in_body: "boolean",
		ray_count: "CountBucket",
		star_count: "CountBucket",
	},
	CosmoFeatures: {
		ring_count: "CountBucket",
		segment_count: "CountBucket",
		has_radial_structure: "boolean",
		has_to_map: "boolean",
		cell_or_tube_network: "boolean",
	},
	BalneoFeatures: {
		figure_count: "CountBucket",
		has_pools: "boolean",
		has_tubes: "boolean",
		nudity: "boolean",
		figure_posture: "'standing'|'reclining'|'mixed'|'unclear'",
	},
	PharmaFeatures: {
		container_count: "CountBucket",
		container_shape: "'jar'|'cylinder'|'ornate'|'mixed'|'none'",
		has_plant_cuttings: "boolean",
		has_labels: "boolean",
		rows_of_objects: "boolean",
	},
	ZodiacFeatures: {
		medallion_subject: "'animal'|'human'|'object'|'unclear'|'none'",
		surrounding_figure_count: "CountBucket",
		has_tubs_barrels: "boolean",
		has_stars: "boolean",
	},
	RecipesFeatures: {
		marginal_star_count: "CountBucket",
		text_dominant: "boolean",
		short_paragraphs: "boolean",
	},
}).export()

// ---- per-section page records: Core + exactly one feature block ----
export const HerbalPage = v.Core.and({ features: v.HerbalFeatures })
export const AstroPage = v.Core.and({ features: v.AstroFeatures })
export const CosmoPage = v.Core.and({ features: v.CosmoFeatures })
export const BalneoPage = v.Core.and({ features: v.BalneoFeatures })
export const PharmaPage = v.Core.and({ features: v.PharmaFeatures })
export const ZodiacPage = v.Core.and({ features: v.ZodiacFeatures })
export const RecipesPage = v.Core.and({ features: v.RecipesFeatures })
export const TextOnlyPage = v.Core

// ---- unified, map-free record: Core + every block optional ----
export const VoynichPage = v.Core.and({
	"herbal?": v.HerbalFeatures,
	"astronomical?": v.AstroFeatures,
	"cosmological?": v.CosmoFeatures,
	"biological?": v.BalneoFeatures,
	"pharmaceutical?": v.PharmaFeatures,
	"zodiac?": v.ZodiacFeatures,
	"recipes?": v.RecipesFeatures,
})

export type VoynichPage = typeof VoynichPage.infer

/** Section name keyed by ZL/IVTFF `$I` illustration-type code. */
export const SECTION_BY_ICODE = {
	H: "herbal",
	A: "astronomical",
	C: "cosmological",
	B: "biological",
	P: "pharmaceutical",
	Z: "zodiac",
	S: "recipes",
	T: "text_only",
} as const

export type ICode = keyof typeof SECTION_BY_ICODE
export type SectionName = (typeof SECTION_BY_ICODE)[ICode]

const SCHEMA_BY_SECTION: Record<SectionName, Type> = {
	herbal: HerbalPage,
	astronomical: AstroPage,
	cosmological: CosmoPage,
	biological: BalneoPage,
	pharmaceutical: PharmaPage,
	zodiac: ZodiacPage,
	recipes: RecipesPage,
	text_only: TextOnlyPage,
}

/** Pick the focused schema for a folio given its `$I` code (falls back to unified). */
export function schemaForICode(code: string): Type {
	const section = SECTION_BY_ICODE[code as ICode]
	return section ? SCHEMA_BY_SECTION[section] : VoynichPage
}

/** JSON Schema (for the websocket `schema` field) per `$I` code. */
export function jsonSchemaForICode(code: string): Record<string, unknown> {
	return schemaForICode(code).toJsonSchema() as Record<string, unknown>
}

export const unifiedJsonSchema = VoynichPage.toJsonSchema() as Record<string, unknown>

// ---- secondary, schema-bounded variants of the two free-form prompts ----
// (prompt_keywords.md / prompt_generic.md). The bound (maxItems) also prevents the 8B's
// greedy-decoding repetition loop that runs free arrays to the token limit.

/** prompt_keywords.md → a bounded list of concrete tags. */
export const Keywords = type("string[] <= 12")
export const keywordsJsonSchema = Keywords.toJsonSchema() as Record<string, unknown>

/** prompt_generic.md → normalized regions with 0–1000 bounding boxes. */
// bbox as an object (not a tuple): arktype renders tuples with `items:false`, which
// llama.cpp's json-schema→grammar converter rejects. Object also matches the model's
// natural `position:{x,y,w,h}` output.
const v2 = scope({
	Bbox0to1000: {
		x: "0 <= number <= 1000",
		y: "0 <= number <= 1000",
		w: "0 <= number <= 1000",
		h: "0 <= number <= 1000",
	},
	// length caps are essential: an unbounded string field makes the 8B loop at temp 0
	// (it repeats a sentence until maxTokens). maxLength bounds the grammar.
	Region: {
		label: "string <= 60",
		description: "string <= 240",
		bbox: "Bbox0to1000",
	},
	Regions: { elements: "Region[] <= 20" },
}).export()
export const Regions = v2.Regions
export const regionsJsonSchema = Regions.toJsonSchema() as Record<string, unknown>
