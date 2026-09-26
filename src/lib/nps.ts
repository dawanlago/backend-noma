/** Classificação NPS: 9–10 promotor, 7–8 neutro, 0–6 detrator. */
export function npsGroup(rating: number): "promoter" | "passive" | "detractor" {
  if (rating >= 9) return "promoter";
  if (rating >= 7) return "passive";
  return "detractor";
}

/** Nota NPS (−100 a 100) = % promotores − % detratores. */
export function npsScore(ratings: number[]) {
  if (!ratings.length) return 0;
  const promoters = ratings.filter((rating) => rating >= 9).length;
  const detractors = ratings.filter((rating) => rating <= 6).length;
  return Math.round(((promoters - detractors) / ratings.length) * 100);
}
