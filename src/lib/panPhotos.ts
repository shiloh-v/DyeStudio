// Pans no longer store copies of photos (see stripPanPhotos in storage.ts), so
// look them up from the live recipe / Color Lab sketch. Falls back to any copy
// still embedded on an older pan that hasn't been re-saved yet.

type Photo = { id?: string | number; data: string; label?: string };
type HasPhotos = { photo?: string; photos?: Photo[] } | null | undefined;

export function panSource(pan: any, recipes: any[] = [], colorSketches: any[] = []): HasPhotos {
    if (!pan) return null;
    if (pan.recipeId != null && pan.recipeId !== '') {
        const r = recipes.find(r => r.id === parseInt(pan.recipeId));
        if (r) return r;
    }
    if (pan.recipe?.id != null) {
        const r = recipes.find(r => r.id === pan.recipe.id);
        if (r) return r;
    }
    if (pan.colorSketchId != null && pan.colorSketchId !== '') {
        const s = colorSketches.find(s => s.id === parseInt(pan.colorSketchId));
        if (s) return s;
    }
    if (pan.colorSketch?.id != null) {
        const s = colorSketches.find(s => s.id === pan.colorSketch.id);
        if (s) return s;
    }
    return pan.recipe || pan.colorSketch || null;
}

/** Main photo for a pan thumbnail, or '' if none. */
export function panMainPhoto(pan: any, recipes: any[] = [], colorSketches: any[] = []): string {
    const src = panSource(pan, recipes, colorSketches);
    return src?.photo || src?.photos?.[0]?.data || pan?.recipe?.photo || pan?.colorSketch?.photo || '';
}
