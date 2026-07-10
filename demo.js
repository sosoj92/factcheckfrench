// lib/demo.js — Mode démo : verdicts préenregistrés pour les tournages vidéo.
// Les verdicts et sources reprennent de vrais fact-checks publiés (France 24, COR).
// Chaque scénario se déclenche quand ses mots-clés apparaissent dans la transcription,
// ou manuellement via le bouton « Injecter démo ». Ne se déclenche qu'une fois.

export const DEMO_SCENARIOS = [
  {
    id: "demo-cotisations",
    // Interview du 22/03/2023 — passage sur le financement par les entreprises
    keywords: [
      ["entreprise", "retraite"],
      ["cotis", "entreprise"],
      ["marchent les retraites"],
    ],
    locuteur: "Emmanuel Macron",
    categorie: "social",
    claim:
      "Faire davantage contribuer les entreprises au financement des retraites, « ce n'est pas comme ça que marchent les retraites ».",
    verdict: "faux",
    confiance: "haute",
    explication:
      "Les pensions de retraite sont financées par les cotisations salariales ET patronales. La part patronale est même majoritaire : environ 60 %, contre 40 % pour la part salariale. Les entreprises sont donc déjà au cœur du financement du système, et l'augmentation de leurs cotisations est une option techniquement possible — c'est un choix politique, pas une impossibilité de fonctionnement.",
    sources: [
      {
        titre: "France 24 — Réforme des retraites : les contre-vérités d'Emmanuel Macron",
        url: "https://www.france24.com/fr/france/20230322-r%C3%A9forme-des-retraites-les-contre-v%C3%A9rit%C3%A9s-d-emmanuel-macron",
      },
      {
        titre: "Sécurité sociale — Le financement des retraites",
        url: "https://www.securite-sociale.fr/",
      },
    ],
  },
  {
    id: "demo-deficit",
    // Même interview — passage sur la dérive du déficit des retraites
    keywords: [
      ["déficit", "retraite"],
      ["équilibre", "système"],
      ["sauver", "système"],
    ],
    locuteur: "Emmanuel Macron",
    categorie: "économie",
    claim:
      "Sans réforme, le système de retraites connaîtrait une dérive financière incontrôlée.",
    verdict: "trompeur",
    confiance: "haute",
    explication:
      "Le rapport du Conseil d'orientation des retraites (COR) de septembre 2022 prévoit bien un déficit (de 0,1 % du PIB en 2023 à environ 0,8 % en 2050), mais précise que ses résultats « ne valident pas le bien-fondé des discours qui mettent en avant l'idée d'une dynamique non contrôlée des dépenses de retraite ». La part des dépenses de retraites dans le PIB resterait à peu près stable (13,8 % en 2021, entre 14,2 % et 14,7 % à l'horizon 2032 selon les scénarios). Présenter un déficit limité et documenté comme une dérive incontrôlée relève du cadrage trompeur.",
    sources: [
      {
        titre: "COR — Rapport annuel septembre 2022",
        url: "https://www.cor-retraites.fr/",
      },
      {
        titre: "France 24 — Réforme des retraites : les contre-vérités d'Emmanuel Macron",
        url: "https://www.france24.com/fr/france/20230322-r%C3%A9forme-des-retraites-les-contre-v%C3%A9rit%C3%A9s-d-emmanuel-macron",
      },
    ],
  },
  {
    id: "demo-emplois",
    // Débat d'entre-deux-tours 2022 — « 1,2 million ont retrouvé un travail »
    keywords: [
      ["million", "travail"],
      ["million", "emploi"],
      ["retrouvé un travail"],
    ],
    locuteur: "Emmanuel Macron",
    categorie: "économie",
    claim: "1,2 million de Françaises et de Français ont retrouvé un travail durant le quinquennat.",
    verdict: "plutot_vrai",
    confiance: "haute",
    explication:
      "L'ordre de grandeur est correct mais le chiffre est arrondi à la hausse : entre janvier 2017 et septembre 2021, environ 1,03 million d'emplois salariés ont été créés en France, malgré la crise sanitaire. La dynamique de créations d'emplois est réelle, le chiffre exact est légèrement inférieur à celui avancé.",
    sources: [
      {
        titre: "franceinfo — Vrai ou Fake : 12 affirmations du débat vérifiées",
        url: "https://www.franceinfo.fr/elections/presidentielle/vrai-ou-fake-debat-de-la-presidentielle-on-a-verifie-douze-affirmations-d-emmanuel-macron-et-marine-le-pen_5093455.html",
      },
      { titre: "Insee — Emploi salarié", url: "https://www.insee.fr/" },
    ],
  },
];

/**
 * Détecte si un fragment de transcription correspond à un scénario non encore joué.
 * Chaque entrée de `keywords` est un groupe ET (tous les mots du groupe doivent
 * être présents) ; les groupes entre eux sont en OU.
 */
export function matchDemoScenario(texte, dejaJoues) {
  const t = texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // ignore les accents (transcription imparfaite)
  for (const sc of DEMO_SCENARIOS) {
    if (dejaJoues.has(sc.id)) continue;
    const hit = sc.keywords.some((groupe) =>
      groupe.every((mot) =>
        t.includes(mot.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
      )
    );
    if (hit) return sc;
  }
  return null;
}
