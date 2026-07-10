// lib/api.js — Cœur du fact-checking : extraction d'affirmations + vérification sourcée.
// Utilisé par le service worker (background.js) et le panneau latéral (sidepanel.js).

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

const SOURCES_PRIORITAIRES = `Sources à privilégier (par ordre) :
1. Données officielles françaises : INSEE, vie-publique.fr, Légifrance, data.gouv.fr, Cour des comptes, Assemblée nationale, Sénat, ministères (.gouv.fr)
2. Données officielles européennes/internationales : Eurostat, OCDE, ONU, OMS, Banque mondiale, FMI
3. Fact-checkers reconnus : AFP Factuel, Les Décodeurs (Le Monde), CheckNews (Libération), Vrai ou Faux (franceinfo)
4. Presse de référence avec données vérifiables
À éviter comme preuve : blogs, réseaux sociaux, sites partisans, tribunes d'opinion.`;

export async function getSettings() {
  const defaults = {
    apiKey: "",
    model: DEFAULT_MODEL,
    maxSearches: 3,
    autoCheck: true,
    langue: "fr-FR",
  };
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored };
}

async function callClaude({ apiKey, model, system, messages, tools, maxTokens = 2000 }) {
  const body = { model, max_tokens: maxTokens, system, messages };
  if (tools) body.tools = tools;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `Erreur API (${response.status})`;
    if (response.status === 401) throw new Error("Clé API invalide. Vérifiez-la dans les réglages.");
    if (response.status === 429) throw new Error("Limite de débit atteinte. Patientez quelques secondes.");
    throw new Error(msg);
  }
  return response.json();
}

function extractText(data) {
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const startArr = clean.indexOf("[");
  const first = startArr !== -1 && (startArr < start || start === -1) ? startArr : start;
  if (first === -1) throw new Error("Réponse illisible du modèle.");
  const end = clean.lastIndexOf(clean[first] === "[" ? "]" : "}");
  return JSON.parse(clean.slice(first, end + 1));
}

/**
 * Étape 1 — Extraire les affirmations vérifiables d'un fragment de transcription.
 * Retourne [{ claim, categorie }] — vide si rien de vérifiable.
 */
export async function extraireAffirmations(texte, locuteur) {
  const { apiKey, model } = await getSettings();
  if (!apiKey) throw new Error("Aucune clé API configurée. Ouvrez les réglages de l'extension.");

  const system = `Tu es un assistant de fact-checking pour le débat public français.
On te donne un fragment de transcription orale (souvent imparfaite : mots mal transcrits, ponctuation absente).
Ta seule tâche : repérer les AFFIRMATIONS FACTUELLES VÉRIFIABLES.

Une affirmation vérifiable contient un fait précis contrôlable : chiffre, statistique, date, événement, contenu d'une loi, citation attribuée, comparaison chiffrée, fait historique.
NE RETIENS PAS : opinions, promesses de campagne, prédictions, jugements de valeur, généralités vagues, questions rhétoriques.

Reformule chaque affirmation en une phrase autonome et claire (corrige les erreurs évidentes de transcription, garde le sens exact).
Réponds UNIQUEMENT avec un tableau JSON, sans texte autour :
[{"claim": "...", "categorie": "économie|social|sécurité|immigration|environnement|institutions|santé|éducation|international|autre"}]
Si aucune affirmation vérifiable : []`;

  const contexte = locuteur ? `Locuteur : ${locuteur}\n` : "";
  const data = await callClaude({
    apiKey,
    model,
    system,
    maxTokens: 1000,
    messages: [{ role: "user", content: `${contexte}Fragment :\n"""${texte}"""` }],
  });

  const parsed = parseJson(extractText(data));
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Étape 2 — Vérifier une affirmation avec recherche web.
 * Retourne { verdict, explication, sources: [{titre, url}], confiance }
 */
export async function verifierAffirmation(claim, locuteur) {
  const { apiKey, model, maxSearches } = await getSettings();
  if (!apiKey) throw new Error("Aucune clé API configurée. Ouvrez les réglages de l'extension.");

  const system = `Tu es un fact-checker rigoureux et politiquement neutre, spécialiste du débat public français.
On te donne UNE affirmation à vérifier. Utilise la recherche web pour trouver des sources fiables et récentes.

${SOURCES_PRIORITAIRES}

Verdicts possibles (choisis le plus juste) :
- "vrai" : exact, confirmé par des sources fiables
- "plutot_vrai" : globalement exact, imprécision mineure (chiffre arrondi, léger décalage temporel)
- "trompeur" : contient du vrai mais présenté de façon à induire en erreur (cadrage, omission, hors contexte)
- "faux" : contredit par les sources fiables
- "inverifiable" : impossible à trancher avec les sources disponibles

Règles :
- Neutralité absolue : même rigueur quel que soit le bord politique.
- Distingue le fait brut de son interprétation.
- Si les chiffres varient selon la source/méthode, dis-le.
- Explication : 2 à 4 phrases, en français, précises et sobres. Cite les chiffres corrects si l'affirmation est fausse ou trompeuse.

Après tes recherches, réponds UNIQUEMENT avec ce JSON (sans texte autour) :
{"verdict": "vrai|plutot_vrai|trompeur|faux|inverifiable", "explication": "...", "confiance": "haute|moyenne|basse", "sources": [{"titre": "...", "url": "https://..."}]}`;

  const contexte = locuteur ? ` (déclarée par ${locuteur})` : "";
  const data = await callClaude({
    apiKey,
    model,
    system,
    maxTokens: 3000,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: Number(maxSearches) || 3,
      },
    ],
    messages: [
      {
        role: "user",
        content: `Affirmation à vérifier${contexte} :\n"${claim}"`,
      },
    ],
  });

  const result = parseJson(extractText(data));
  if (!result.verdict) throw new Error("Verdict manquant dans la réponse.");
  result.sources = Array.isArray(result.sources) ? result.sources.slice(0, 5) : [];
  return result;
}

/**
 * Raccourci — vérifier directement un texte sélectionné (article, tweet...).
 * Extrait puis vérifie, en une passe si le texte est déjà une affirmation unique.
 */
export async function verifierTexteSelectionne(texte) {
  const affirmations = await extraireAffirmations(texte, null);
  if (affirmations.length === 0) {
    return { affirmations: [], message: "Aucune affirmation factuelle vérifiable dans ce passage (opinion, promesse ou généralité)." };
  }
  return { affirmations };
}

export const VERDICT_LABELS = {
  vrai: "Vrai",
  plutot_vrai: "Plutôt vrai",
  trompeur: "Trompeur",
  faux: "Faux",
  inverifiable: "Invérifiable",
};
