// Domain model for Celestial Dyeworks.
//
// These mirror the shapes stored in Supabase (see scripts/backup.mjs output and
// src/lib/storage.ts for the camelCase<->snake_case boundary). The data has
// evolved loosely over time — many numeric fields are entered as strings via
// form inputs, and a few tables carry legacy duplicate columns — so fields are
// intentionally permissive (optional, string|number unions, an index-signature
// escape hatch). Tighten these incrementally as components get typed.

export type ID = number; // JS Date.now() timestamp, stored as BIGINT
export type Num = number | string; // values that may arrive as form-input strings

export interface DyeAmount {
  name?: string;
  color?: string;
  amount?: Num;
  unit?: string;
}

export interface Recipe {
  id: ID;
  recipeId?: string;
  name?: string;
  yarnWeight?: Num;
  colorType?: 'tonal' | 'variegated' | 'speckled' | string;
  ingredients?: DyeAmount[];
  colorSolutions?: { name?: string; dyes?: DyeAmount[]; targetMl?: Num }[];
  instructions?: string;
  photo?: string;
  photos?: { id: ID; data: string; label?: string }[];
  notes?: string;
  created?: string;
  [key: string]: any;
}

export interface ColorSketch {
  id: ID;
  colorId?: string;
  customName?: string;
  type?: 'tonal' | 'variegated' | 'speckled' | string;
  yarnWeight?: Num;
  dyes?: DyeAmount[];
  sections?: { name?: string; dyes?: DyeAmount[] }[];
  baseColors?: DyeAmount[];
  speckles?: DyeAmount[];
  notes?: string;
  photo?: string;
  experimentNotes?: string;
  archived?: boolean;
  [key: string]: any;
}

export interface YarnDetail {
  base?: string;
  hankSize?: Num;
  quantity?: Num;
}

export type PanType = 'pan' | 'gradientTray' | 'dyeSquareTray' | 'adHoc' | 'kit' | 'colorLab';

export interface Pan {
  id?: ID;
  type?: PanType | string;
  colorway?: string;
  recipeId?: string;
  capacity?: Num;
  yarns?: YarnDetail[];
  recipe?: Recipe | null;
  // gradient tray
  gradientDye?: string;
  gradientYarnBase?: string;
  gradientHankSize?: Num;
  depths?: number[];
  // dye-square tray
  squareColorA?: string;
  squareColorB?: string;
  amounts?: number[];
  // color lab
  colorSketchId?: string;
  colorSketch?: ColorSketch | null;
  // ad hoc
  adHocLabel?: string;
  experimentNotes?: string;
  // kit
  kitId?: string;
  kitName?: string;
  kitColors?: any[];
  kitSelectedColorIds?: ID[];
  kitYarns?: YarnDetail[];
  [key: string]: any;
}

export interface DyeSession {
  id: ID;
  sessionId?: string;
  name?: string;
  date?: string;
  pans?: Pan[];
  notes?: string;
  archived?: boolean;
  [key: string]: any;
}

export interface Batch {
  id: ID;
  batchId?: string;
  recipeId?: string;
  recipeName?: string;
  colorway?: string;
  customColorway?: string;
  skeins?: Num;
  // 'stocked' is the terminal stage (finished inventory). 'sold' is the legacy
  // terminal value kept for back-compat with pre-rename data; treat via isStocked().
  status?: 'dyeing' | 'drying' | 'ready' | 'stocked' | 'sold' | string;
  startDate?: string;
  notes?: string;
  batchNotes?: string;
  experimentNotes?: string;
  colorSketch?: ColorSketch | null;
  yarnDetails?: YarnDetail[];
  costBreakdown?: Record<string, number>;
  totalCost?: number;
  costPerSkein?: number;
  isAdHoc?: boolean;
  salePrice?: number;      // expected/list price set when stocked (basis for projected margin)
  pricePerSkein?: number;
  profit?: number;         // projected: salePrice - totalCost
  profitMargin?: number;   // projected: profit / salePrice
  soldDate?: string;       // date the batch was stocked (kept name for back-compat)
  [key: string]: any;
}

export interface InventoryItem {
  id: ID;
  name?: string;
  category?: 'dye' | 'yarn base' | 'chemical' | 'tool' | 'ball band' | 'other' | string;
  quantity?: Num;
  unit?: string;
  hankSize?: Num;
  lowStockThreshold?: Num;
  cost?: Num;
  purchasePrice?: Num;
  purchaseOunces?: Num;
  supplier?: string;
  color?: string;
  notes?: string;
  myYarnName?: string;
  forYarnBase?: string;
  [key: string]: any;
}

export interface Kit {
  id: ID;
  bundleId?: string;
  bundleType?: string;
  baseYarn?: string;
  name?: string;
  description?: string;
  colors?: { colorwayName?: string; quantity?: Num }[];
  notes?: string;
  created?: string;
  [key: string]: any;
}

export interface Gradient {
  id: ID;
  gradientId?: string;
  name?: string;
  type?: 'dos' | 'square' | string;
  dyeColor?: string;
  colorA?: string;
  colorB?: string;
  yarnBase?: string;
  skeinWeight?: Num;
  shades?: { dos: number; ml: number }[];
  squares?: { square: number; colorA_ml: number; colorB_ml: number; dos: number }[];
  photos?: { id: ID; data: string; label?: string }[];
  photo?: string;
  notes?: string;
  created?: string;
  [key: string]: any;
}

export interface Sale {
  id: ID;
  [key: string]: any;
}

export interface YarnBaseSize {
  amount: Num;      // weight in the base's weightUnit (grams or ounces)
  sku?: string;
  packSize?: Num;   // how many skeins come in a pack (defaults to 1)
  packPrice?: Num;  // price for the whole pack; per-skein price = packPrice / packSize
  length?: Num;     // optional override of the derived length (in the base's lengthUnit)
}

// A yarn base in the catalog — base-level specs entered once, plus the sizes it
// comes in. Length per 100 (weightUnit) auto-derives each size's length; a size
// can override it. Units vary by supplier, so weight (g/oz) and length (yd/m)
// are per-base.
export interface YarnBase {
  id: ID;
  myName: string;          // e.g. "Luna DK"
  supplier?: string;       // e.g. "Wool2Dye4"
  supplierName?: string;   // supplier's base name, e.g. "W2D4 Merino DK SW"
  weight?: string;         // yarn weight, e.g. "DK"
  fiberContent?: string;
  needleSize?: string;
  gauge?: string;
  wpi?: string;
  plies?: string;
  weightUnit?: 'g' | 'oz';
  lengthUnit?: 'yd' | 'm';
  lengthPer100?: Num;      // length (lengthUnit) per 100 of weightUnit
  sizes?: YarnBaseSize[];
  notes?: string;
}

export interface Settings {
  colorTypes: string[];
  inventoryCategories: string[];
  units: string[];
  suppliers: string[];
  yarnBaseMappings: { supplierName: string; myName: string }[];
  sizeMappings: { grams: number; name: string }[];
  yarnBases?: YarnBase[];
}
