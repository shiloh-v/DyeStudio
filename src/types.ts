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
  status?: 'dyeing' | 'drying' | 'ready' | 'sold' | string;
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
  salePrice?: number;
  pricePerSkein?: number;
  profit?: number;
  profitMargin?: number;
  soldDate?: string;
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

export interface Settings {
  colorTypes: string[];
  inventoryCategories: string[];
  units: string[];
  suppliers: string[];
  yarnBaseMappings: { supplierName: string; myName: string }[];
  sizeMappings: { grams: number; name: string }[];
}
