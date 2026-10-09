// The study: which categories are measured, and the brands in each. Switch a
// category on or off with `enabled`. Every brand in a category is measured as
// the subject in turn, with the others as its competitors; each gets its own
// dashboard. Brand-neutral questions are shared by the whole category, so they
// are asked and read once; only the brand-specific questions repeat per brand.

export type StudyBrand = {
  id: string;
  label: string;
  /** official US site, for owned-source and crawler reads */
  domain: string;
  /** the product line shoppers name, e.g. "BRAVIA" */
  productLine: string;
};

export type StudyCategory = {
  /** category slug from config/categories.ts */
  category: string;
  enabled: boolean;
  /**
   * The brand whose brand-specific questions are the reference bank's own
   * wording (Sony for TV). Other brands' versions are rewritten from it.
   */
  reference?: string;
  brands: StudyBrand[];
};

export const STUDY: StudyCategory[] = [
  {
    category: "tv",
    enabled: true,
    reference: "sony",
    brands: [
      { id: "sony", label: "Sony", domain: "electronics.sony.com", productLine: "BRAVIA" },
      { id: "samsung", label: "Samsung", domain: "samsung.com", productLine: "Neo QLED" },
      { id: "lg", label: "LG", domain: "lg.com", productLine: "OLED evo" },
      { id: "tcl", label: "TCL", domain: "tcl.com", productLine: "QM Mini LED" },
      { id: "hisense", label: "Hisense", domain: "hisense-usa.com", productLine: "ULED" },
    ],
  },
  {
    category: "smartphones",
    enabled: true,
    brands: [
      { id: "apple", label: "Apple", domain: "apple.com", productLine: "iPhone" },
      { id: "samsung", label: "Samsung", domain: "samsung.com", productLine: "Galaxy" },
      { id: "google", label: "Google", domain: "store.google.com", productLine: "Pixel" },
    ],
  },
];

export type Rival = { id: string; label: string };

export type BrandCategory = { category: string; productLine: string; competitors: Rival[] };

/** Every brand × category in the study, keyed "<brand>-<category>". */
export const PAIRS = STUDY.flatMap((s) =>
  s.brands.map((b) => ({
    key: `${b.id}-${s.category}`,
    enabled: s.enabled,
    brand: { id: b.id, label: b.label, domain: b.domain },
    bc: { category: s.category, productLine: b.productLine, competitors: s.brands.filter((x) => x.id !== b.id).map((x) => ({ id: x.id, label: x.label })) } as BrandCategory,
  })),
);

export const studyCategory = (slug: string): StudyCategory => {
  const s = STUDY.find((x) => x.category === slug);
  if (!s) throw new Error(`category ${slug} is not in the study (config/brands.ts)`);
  return s;
};

/** The market is fixed: US shoppers, US Bright Data sessions. */
export const COUNTRY = "US";
