# Véridique — Fact-checking politique en temps réel 🇫🇷

Extension Chrome de vérification factuelle des discours politiques, débats télévisés et
articles, inspirée d'InTruth mais pensée pour le débat public **français**, avec des
sources françaises prioritaires (INSEE, vie-publique.fr, AFP Factuel, Les Décodeurs…).

## Fonctionnalités

| | |
|---|---|
| 🎙️ **Écoute en direct** | Transcription du débat via le micro (Web Speech API, fr-FR), détection automatique des affirmations vérifiables, verdict en quelques secondes |
| 🖱️ **Clic droit sur du texte** | Sélectionnez un passage d'article, un tweet, un extrait de programme → « Véridique : vérifier » |
| ⌨️ **Vérification manuelle** | Onglet « Texte » pour coller n'importe quel contenu |
| 🗣️ **Attribution des locuteurs** | Ajoutez les intervenants du débat et taguez qui parle en un clic |
| 📊 **Stats par intervenant** | Bilan vrai / plutôt vrai / trompeur / faux / invérifiable par politicien |
| 🗂️ **Historique + export** | Toutes les vérifications conservées en local, export JSON et CSV |
| 🇫🇷 **Sources fiables** | Priorité aux données officielles françaises et européennes, puis aux fact-checkers reconnus |

Verdicts possibles : **Vrai · Plutôt vrai · Trompeur · Faux · Invérifiable**, chacun
avec une explication de 2–4 phrases, un niveau de confiance et des sources cliquables.

## Installation (mode développeur)

1. Téléchargez et décompressez `veridique.zip`.
2. Ouvrez Chrome → `chrome://extensions`.
3. Activez le **Mode développeur** (interrupteur en haut à droite).
4. Cliquez **« Charger l'extension non empaquetée »** et sélectionnez le dossier `veridique`.
5. Cliquez sur l'icône Véridique → le panneau latéral s'ouvre.
6. Ouvrez les réglages (⚙) et collez votre **clé API Anthropic**
   (créée sur [console.anthropic.com](https://console.anthropic.com/)).

## Utilisation en direct (débat, interview, meeting)

1. Lancez la vidéo **avec le son sur haut-parleurs** (la transcription passe par le micro).
2. Ouvrez le panneau Véridique → onglet **Direct** → « Démarrer l'écoute ».
3. Autorisez le micro à la première utilisation.
4. Ajoutez les intervenants (« + Ajouter ») et cliquez sur le nom de celui qui parle.
5. Les affirmations vérifiables sont détectées et vérifiées automatiquement ;
   les verdicts s'empilent avec leurs sources.

## Coût

L'extension utilise **votre** clé API : vous payez uniquement votre consommation.
Ordres de grandeur pour un débat d'une heure avec le réglage « équilibré »
(Sonnet + 3 recherches par vérification) : de l'ordre de quelques dizaines de
vérifications, généralement quelques euros. Pour réduire les coûts : choisissez
Haiku et « 2 recherches » dans les réglages.

## Confidentialité

- Aucun serveur intermédiaire : votre navigateur parle directement à l'API Anthropic.
- La clé API et l'historique restent en **stockage local** de votre navigateur.
- Rien n'est collecté, transmis à un tiers ou vendu.

## Limites connues (honnêteté oblige)

- La transcription passe par le micro : elle capte aussi les bruits ambiants.
  Un environnement calme + volume correct = meilleurs résultats.
- Les verdicts sont générés par IA : ils peuvent être incomplets ou erronés.
  **Vérifiez toujours les sources citées.** Véridique est un outil d'aide au
  discernement, pas une autorité.
- Les opinions, promesses et prédictions ne sont volontairement pas vérifiées.
- La Web Speech API de Chrome envoie l'audio aux serveurs de reconnaissance
  vocale de Google pour la transcription.

## Architecture

```
veridique/
├── manifest.json        # Manifest V3
├── background.js        # Service worker : menu contextuel, side panel
├── sidepanel.html/css/js# Interface principale (Direct, Texte, Historique, Stats)
├── options.html/js      # Réglages : clé API, modèle, budget recherche
├── lib/api.js           # Pipeline : extraction d'affirmations → vérification sourcée
└── icons/               # Icônes
```

Pipeline de vérification :
1. **Extraction** — le fragment de transcription est analysé pour isoler les
   affirmations factuelles vérifiables (les opinions sont écartées).
2. **Vérification** — chaque affirmation est contrôlée via recherche web avec
   priorité aux sources officielles françaises, puis renvoyée en JSON structuré
   (verdict, explication, confiance, sources).

## Publication sur le Chrome Web Store (optionnel)

1. Créez un compte développeur sur le [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/) (5 $ une fois).
2. Zippez le dossier (le zip fourni convient), uploadez-le, remplissez la fiche
   (captures d'écran, politique de confidentialité — le texte de la section
   « Confidentialité » ci-dessus peut servir de base).
3. Déclarez les permissions : `storage`, `contextMenus`, `sidePanel`, `activeTab`
   et l'accès micro (justification : transcription locale des débats).
