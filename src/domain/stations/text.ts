/**
 * Normaliza una cadena de texto para facilitar comparaciones difusas (fuzzy matching).
 * Elimina acentos, pasa a minúsculas, y opcionalmente remueve stop words comunes.
 */
export function normalizeText(text: string | null | undefined, removeStopWords = false): string {
  if (!text) return "";
  let s = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (removeStopWords) {
    const stopWords = /\b(estacion|carga|electrolinera|eds|punto|sas|s a s|sa|s a|ltda|en|de|la|el|los|las|y|para|copec|terpel|voltex|brio|ev)\b/g;
    s = s.replace(stopWords, " ").replace(/\s+/g, " ").trim();
  }
  return s;
}

/**
 * Normaliza una dirección colombiana, estandarizando abreviaturas comunes.
 */
export function normalizeAddress(address: string | null | undefined): string {
  if (!address) return "";
  const s = address
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Normalizar signos como # y No.
    .replace(/(#|no\.|numero|número)/g, " # ")
    // Reemplazar abreviaturas viales comunes
    .replace(/\b(carrera|cra|kr|k)\b/g, "cra")
    .replace(/\b(calle|cll|cl|c)\b/g, "cll")
    .replace(/\b(avenida|av)\b/g, "av")
    .replace(/\b(diagonal|diag|dg)\b/g, "dg")
    .replace(/\b(transversal|trans|tv)\b/g, "tv")
    .replace(/\b(autopista|auto)\b/g, "autopista")
    // Quitar puntuación innecesaria
    .replace(/[^a-z0-9#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/**
 * Calcula el coeficiente de similitud de Jaccard entre dos conjuntos de tokens (palabras).
 */
export function jaccardSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * Calcula la similitud de Dice usando trigramas (grupos de 3 caracteres).
 * Ideal para nombres con pequeñas variaciones ortográficas.
 */
export function diceTrigrams(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  
  const getTrigrams = (str: string) => {
    const padded = `  ${str}  `;
    const trigrams = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) {
      trigrams.add(padded.slice(i, i + 3));
    }
    return trigrams;
  };

  const triA = getTrigrams(a);
  const triB = getTrigrams(b);
  if (triA.size === 0 && triB.size === 0) return 1;

  let intersection = 0;
  for (const tri of triA) {
    if (triB.has(tri)) intersection++;
  }
  return (2 * intersection) / (triA.size + triB.size);
}

/**
 * Retorna el máximo entre Jaccard y Dice para dos textos.
 */
export function textSimilarity(a: string, b: string, removeStopWords = true): number {
  const normA = normalizeText(a, removeStopWords);
  const normB = normalizeText(b, removeStopWords);
  return Math.max(jaccardSimilarity(normA, normB), diceTrigrams(normA, normB));
}

/**
 * Similitud para direcciones colombianas.
 */
export function addressSimilarity(a: string, b: string): number {
  const normA = normalizeAddress(a);
  const normB = normalizeAddress(b);
  return Math.max(jaccardSimilarity(normA, normB), diceTrigrams(normA, normB));
}
