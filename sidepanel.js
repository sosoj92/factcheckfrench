// sidepanel.js — Logique du panneau : écoute, extraction, vérification, historique, stats.

import {
  extraireAffirmations,
  verifierAffirmation,
  getSettings,
  VERDICT_LABELS,
} from "./lib/api.js";
import { DEMO_SCENARIOS, matchDemoScenario } from "./lib/demo.js";

/* ============================================================
   État global
============================================================ */
const state = {
  listening: false,
  recognition: null,
  restartTimer: null,
  buffer: "",            // texte finalisé en attente d'extraction
  bufferTimer: null,
  speakers: ["Inconnu"],
  currentSpeaker: "",    // "" = Inconnu
  queue: 0,              // vérifications en cours
  historique: [],        // [{id, claim, locuteur, verdict, explication, sources, confiance, date, categorie}]
  demoMode: false,
  demoJoues: new Set(),  // scénarios démo déjà déclenchés
  demoIndex: 0,          // pour l'injection manuelle
};

const BUFFER_MAX_CHARS = 180;   // seuil de déclenchement de l'extraction
const BUFFER_MAX_WAIT = 8000;   // ms max avant extraction même si court
const HISTORY_CAP = 500;

/* ============================================================
   Raccourcis DOM
============================================================ */
const $ = (id) => document.getElementById(id);
const feedEl = $("feed");
const feedTexteEl = $("feed-texte");
const feedHistoEl = $("feed-historique");
const transcriptEl = $("transcript");

/* ============================================================
   Initialisation
============================================================ */
init();

async function init() {
  // Onglets
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  $("btn-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("banner-open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("btn-listen").addEventListener("click", toggleListening);
  $("btn-add-speaker").addEventListener("click", addSpeaker);
  $("btn-check-text").addEventListener("click", checkManualText);
  $("btn-export-json").addEventListener("click", exportJson);
  $("btn-export-csv").addEventListener("click", exportCsv);
  $("btn-clear-history").addEventListener("click", clearHistory);

  // Clé API présente ?
  const { apiKey } = await getSettings();
  if (!apiKey) $("banner-no-key").classList.remove("hidden");

  // Mode démo activé ?
  const { demoMode } = await chrome.storage.local.get({ demoMode: false });
  state.demoMode = demoMode;
  if (demoMode) {
    $("btn-inject-demo").classList.remove("hidden");
    $("btn-inject-demo").addEventListener("click", injectNextDemo);
  }

  // Charger l'historique
  const stored = await chrome.storage.local.get({ historique: [], speakers: [] });
  state.historique = stored.historique;
  if (stored.speakers.length) {
    state.speakers = ["Inconnu", ...stored.speakers.filter((s) => s !== "Inconnu")];
    renderSpeakers();
  }
  renderHistory();
  renderStats();

  // Texte sélectionné en attente (clic droit avant ouverture du panneau) ?
  chrome.runtime.sendMessage({ type: "SIDEPANEL_READY" }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.pendingSelection) {
      switchTab("texte");
      $("texte-input").value = res.pendingSelection;
      checkManualText();
    }
  });

  // Sélections envoyées pendant que le panneau est ouvert
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CHECK_SELECTION" && msg.texte) {
      switchTab("texte");
      $("texte-input").value = msg.texte;
      checkManualText();
    }
  });
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name)
  );
  document.querySelectorAll(".tab-panel").forEach((p) =>
    p.classList.toggle("active", p.id === `tab-${name}`)
  );
  if (name === "historique") renderHistory();
  if (name === "stats") renderStats();
}

/* ============================================================
   Reconnaissance vocale (Web Speech API, fr-FR)
============================================================ */
function toggleListening() {
  state.listening ? stopListening() : startListening();
}

async function ensureMicPermission() {
  // Le panneau latéral ne peut pas afficher la demande d'autorisation micro :
  // si elle n'est pas déjà accordée, on ouvre une page dédiée dans un onglet.
  try {
    const perm = await navigator.permissions.query({ name: "microphone" });
    if (perm.state === "granted") return true;
  } catch (_) {
    // navigateur sans permissions.query pour le micro : on tente quand même
    return true;
  }
  setStatus("autorisation micro requise — un onglet vient de s'ouvrir");
  chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
  return false;
}

async function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setStatus("reconnaissance vocale non disponible dans ce navigateur");
    return;
  }

  // Sans clé API, la transcription tournerait pour rien (sauf en mode démo)
  const { apiKey } = await getSettings();
  if (!apiKey && !state.demoMode) {
    $("banner-no-key").classList.remove("hidden");
    setStatus("configurez d'abord votre clé API (⚙)");
    return;
  }

  const ok = await ensureMicPermission();
  if (!ok) return;

  const rec = new SR();
  rec.lang = "fr-FR";
  rec.continuous = true;
  rec.interimResults = true;

  rec.onstart = () => {
    setStatus("🔴 micro actif — parlez ou lancez la vidéo");
  };

  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        state.buffer += res[0].transcript + " ";
      } else {
        interim += res[0].transcript;
      }
    }
    renderTranscript(interim);
    if (state.buffer.length >= BUFFER_MAX_CHARS) flushBuffer();
    else scheduleFlush();
  };

  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      setStatus("micro non autorisé — un onglet d'autorisation vient de s'ouvrir");
      stopListening();
      chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
    } else if (e.error === "network") {
      setStatus("erreur réseau — la reconnaissance vocale nécessite une connexion");
    } else if (e.error !== "no-speech" && e.error !== "aborted") {
      setStatus(`erreur : ${e.error}`);
    }
  };

  rec.onend = () => {
    // Chrome coupe la reconnaissance après un silence : on relance en différé
    // tant que l'utilisateur n'a pas cliqué sur « Arrêter ».
    if (!state.listening) return;
    setStatus("micro en pause — relance…");
    clearTimeout(state.restartTimer);
    state.restartTimer = setTimeout(() => {
      if (!state.listening) return;
      try {
        rec.start();
      } catch (_) {
        // instance morte : on en recrée une proprement
        state.listening = false;
        startListening();
      }
    }, 300);
  };

  try {
    rec.start();
  } catch (e) {
    setStatus("impossible de démarrer le micro");
    return;
  }

  state.recognition = rec;
  state.listening = true;
  $("btn-listen").classList.add("listening");
  $("btn-listen-label").textContent = "Arrêter l'écoute";
  setStatus("écoute en cours…");
}

function stopListening() {
  state.listening = false;
  clearTimeout(state.restartTimer);
  if (state.recognition) {
    try { state.recognition.stop(); } catch (_) {}
    state.recognition = null;
  }
  flushBuffer(); // vérifier ce qui reste
  $("btn-listen").classList.remove("listening");
  $("btn-listen-label").textContent = "Démarrer l'écoute";
  setStatus("inactif");
}

function scheduleFlush() {
  if (state.bufferTimer) return;
  state.bufferTimer = setTimeout(flushBuffer, BUFFER_MAX_WAIT);
}

function flushBuffer() {
  clearTimeout(state.bufferTimer);
  state.bufferTimer = null;
  const texte = state.buffer.trim();
  state.buffer = "";
  if (texte.length < 25) return; // trop court pour contenir une affirmation
  traiterFragment(texte, currentSpeakerName());
}

function renderTranscript(interim) {
  const finalTxt = state.buffer.slice(-400);
  transcriptEl.innerHTML = "";
  if (!finalTxt && !interim) {
    transcriptEl.innerHTML = '<span class="placeholder">La transcription apparaîtra ici…</span>';
    return;
  }
  const fin = document.createElement("span");
  fin.textContent = finalTxt;
  const int = document.createElement("span");
  int.className = "interim";
  int.textContent = interim;
  transcriptEl.append(fin, int);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function setStatus(txt) {
  $("listen-status").textContent = txt;
}

/* ============================================================
   Intervenants
============================================================ */
function currentSpeakerName() {
  return state.currentSpeaker || null; // null = inconnu
}

function addSpeaker() {
  const nom = prompt("Nom de l'intervenant (ex. : Première ministre, candidat X…) :");
  if (!nom || !nom.trim()) return;
  const clean = nom.trim().slice(0, 60);
  if (!state.speakers.includes(clean)) {
    state.speakers.push(clean);
    chrome.storage.local.set({ speakers: state.speakers.filter((s) => s !== "Inconnu") });
  }
  state.currentSpeaker = clean;
  renderSpeakers();
}

function renderSpeakers() {
  const wrap = $("speaker-chips");
  wrap.innerHTML = "";
  state.speakers.forEach((name) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    const value = name === "Inconnu" ? "" : name;
    chip.textContent = name;
    if (value === state.currentSpeaker) chip.classList.add("active");
    chip.addEventListener("click", () => {
      state.currentSpeaker = value;
      renderSpeakers();
    });
    wrap.appendChild(chip);
  });
}

/* ============================================================
   Pipeline de vérification
============================================================ */
async function traiterFragment(texte, locuteur) {
  // Mode démo : si le passage attendu est détecté, on affiche le verdict préenregistré
  if (state.demoMode) {
    const sc = matchDemoScenario(texte, state.demoJoues);
    if (sc) {
      state.demoJoues.add(sc.id);
      jouerScenarioDemo(sc);
      return;
    }
    // En mode démo sans clé API, on s'arrête là (pas d'appel réseau)
    const { apiKey } = await getSettings();
    if (!apiKey) return;
  }

  updateQueue(+1, "analyse du fragment…");
  try {
    const affirmations = await extraireAffirmations(texte, locuteur);
    if (affirmations.length === 0) {
      setStatus("🔴 micro actif — rien de vérifiable dans ce passage");
    }
    for (const a of affirmations) {
      lancerVerification(a.claim, locuteur, a.categorie, feedEl);
    }
  } catch (e) {
    afficherErreur(feedEl, `Analyse impossible : ${e.message}`);
  } finally {
    updateQueue(-1);
  }
}

/* ---------- Mode démo ---------- */
function jouerScenarioDemo(sc) {
  const card = creerCartePending(crypto.randomUUID(), sc.claim, sc.locuteur);
  feedEl.querySelector(".placeholder")?.remove();
  feedEl.prepend(card);
  updateQueue(+1, "vérification en cours…");
  // Délai réaliste (recherche web simulée) pour un rendu naturel à l'écran
  const delai = 2500 + Math.random() * 2000;
  setTimeout(() => {
    remplirCarte(card, sc);
    updateQueue(-1);
    sauvegarder({ ...sc, id: crypto.randomUUID(), date: new Date().toISOString() });
  }, delai);
}

function injectNextDemo() {
  const restants = DEMO_SCENARIOS.filter((sc) => !state.demoJoues.has(sc.id));
  if (restants.length === 0) {
    // tout a été joué : on réinitialise pour permettre plusieurs prises
    state.demoJoues.clear();
    return injectNextDemo();
  }
  const sc = restants[0];
  state.demoJoues.add(sc.id);
  jouerScenarioDemo(sc);
}

async function lancerVerification(claim, locuteur, categorie, container) {
  const id = crypto.randomUUID();
  const card = creerCartePending(id, claim, locuteur);
  container.querySelector(".placeholder")?.remove();
  container.prepend(card);

  updateQueue(+1, "vérification en cours…");
  try {
    const resultat = await verifierAffirmation(claim, locuteur);
    const entry = {
      id,
      claim,
      locuteur: locuteur || "Inconnu",
      categorie: categorie || "autre",
      verdict: resultat.verdict,
      explication: resultat.explication,
      confiance: resultat.confiance,
      sources: resultat.sources,
      date: new Date().toISOString(),
    };
    remplirCarte(card, entry);
    await sauvegarder(entry);
  } catch (e) {
    card.querySelector(".badge").textContent = "Erreur";
    card.querySelector(".badge").className = "badge v-inverifiable";
    const err = document.createElement("p");
    err.className = "card-error";
    err.textContent = e.message;
    card.appendChild(err);
  } finally {
    updateQueue(-1);
  }
}

function updateQueue(delta, label) {
  state.queue = Math.max(0, state.queue + delta);
  $("queue-status").textContent = state.queue > 0 ? (label || `${state.queue} en cours…`) : "";
}

/* ============================================================
   Cartes de verdict
============================================================ */
function creerCartePending(id, claim, locuteur) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.id = id;

  const top = document.createElement("div");
  top.className = "card-top";
  const badge = document.createElement("span");
  badge.className = "badge pending";
  badge.innerHTML = '<span class="spinner"></span>Vérification';
  const meta = document.createElement("span");
  meta.className = "card-meta";
  meta.textContent = `${locuteur || "Inconnu"} · ${heure()}`;
  top.append(badge, meta);

  const claimEl = document.createElement("p");
  claimEl.className = "card-claim";
  claimEl.textContent = `« ${claim} »`;

  card.append(top, claimEl);
  return card;
}

function remplirCarte(card, entry) {
  const badge = card.querySelector(".badge");
  badge.className = `badge v-${entry.verdict}`;
  badge.textContent = VERDICT_LABELS[entry.verdict] || entry.verdict;
  card.className = `card v-${entry.verdict}`;

  const expl = document.createElement("p");
  expl.className = "card-explication";
  expl.textContent = entry.explication;
  card.appendChild(expl);

  if (entry.confiance) {
    const conf = document.createElement("p");
    conf.className = "confiance";
    conf.textContent = `Confiance : ${entry.confiance}`;
    card.appendChild(conf);
  }

  if (entry.sources?.length) {
    const src = document.createElement("div");
    src.className = "card-sources";
    entry.sources.forEach((s) => {
      if (!s.url || !/^https?:\/\//.test(s.url)) return;
      const a = document.createElement("a");
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = `↗ ${s.titre || s.url}`;
      src.appendChild(a);
    });
    card.appendChild(src);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copier";
  copyBtn.addEventListener("click", () => copierEntry(entry, copyBtn));
  actions.appendChild(copyBtn);
  card.appendChild(actions);
}

function copierEntry(entry, btn) {
  const lines = [
    `Affirmation (${entry.locuteur}) : « ${entry.claim} »`,
    `Verdict : ${VERDICT_LABELS[entry.verdict] || entry.verdict}`,
    entry.explication,
    ...(entry.sources || []).map((s) => `Source : ${s.url}`),
    "— vérifié avec Véridique",
  ];
  navigator.clipboard.writeText(lines.join("\n")).then(() => {
    btn.textContent = "Copié ✓";
    setTimeout(() => (btn.textContent = "Copier"), 1500);
  });
}

function afficherErreur(container, message) {
  const p = document.createElement("p");
  p.className = "card-error";
  p.textContent = message;
  container.prepend(p);
  setTimeout(() => p.remove(), 20000);
}

function heure() {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/* ============================================================
   Vérification manuelle (onglet Texte)
============================================================ */
async function checkManualText() {
  const texte = $("texte-input").value.trim();
  if (texte.length < 15) {
    afficherErreur(feedTexteEl, "Texte trop court pour être analysé.");
    return;
  }
  const btn = $("btn-check-text");
  btn.disabled = true;
  btn.textContent = "Analyse en cours…";
  try {
    const affirmations = await extraireAffirmations(texte, null);
    if (affirmations.length === 0) {
      afficherErreur(feedTexteEl, "Aucune affirmation factuelle vérifiable détectée (opinion, promesse ou généralité).");
    }
    for (const a of affirmations) {
      lancerVerification(a.claim, null, a.categorie, feedTexteEl);
    }
  } catch (e) {
    afficherErreur(feedTexteEl, e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Vérifier ce texte";
  }
}

/* ============================================================
   Historique
============================================================ */
async function sauvegarder(entry) {
  state.historique.unshift(entry);
  if (state.historique.length > HISTORY_CAP) state.historique.length = HISTORY_CAP;
  await chrome.storage.local.set({ historique: state.historique });
}

function renderHistory() {
  feedHistoEl.innerHTML = "";
  if (state.historique.length === 0) {
    feedHistoEl.innerHTML = '<p class="placeholder">Aucune vérification enregistrée pour l\'instant.</p>';
    return;
  }
  state.historique.forEach((entry) => {
    const card = creerCartePending(entry.id, entry.claim, entry.locuteur);
    card.querySelector(".card-meta").textContent =
      `${entry.locuteur} · ${new Date(entry.date).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
    remplirCarte(card, entry);
    feedHistoEl.appendChild(card);
  });
}

async function clearHistory() {
  if (!confirm("Effacer tout l'historique des vérifications ?")) return;
  state.historique = [];
  await chrome.storage.local.set({ historique: [] });
  renderHistory();
  renderStats();
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  download(
    `veridique-${Date.now()}.json`,
    JSON.stringify(state.historique, null, 2),
    "application/json"
  );
}

function exportCsv() {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["date", "locuteur", "affirmation", "verdict", "confiance", "categorie", "explication", "sources"].join(";"),
    ...state.historique.map((e) =>
      [
        e.date,
        e.locuteur,
        e.claim,
        VERDICT_LABELS[e.verdict] || e.verdict,
        e.confiance,
        e.categorie,
        e.explication,
        (e.sources || []).map((s) => s.url).join(" | "),
      ].map(esc).join(";")
    ),
  ];
  download(`veridique-${Date.now()}.csv`, "\uFEFF" + rows.join("\n"), "text/csv;charset=utf-8");
}

/* ============================================================
   Statistiques par intervenant
============================================================ */
function renderStats() {
  const container = $("stats-container");
  container.innerHTML = "";
  if (state.historique.length === 0) {
    container.innerHTML = '<p class="placeholder">Les statistiques apparaîtront après vos premières vérifications.</p>';
    return;
  }

  const parLocuteur = {};
  for (const e of state.historique) {
    const loc = e.locuteur || "Inconnu";
    parLocuteur[loc] ??= { vrai: 0, plutot_vrai: 0, trompeur: 0, faux: 0, inverifiable: 0, total: 0 };
    if (parLocuteur[loc][e.verdict] !== undefined) parLocuteur[loc][e.verdict]++;
    parLocuteur[loc].total++;
  }

  const couleurs = {
    vrai: "var(--v-vrai)",
    plutot_vrai: "var(--v-plutot)",
    trompeur: "var(--v-trompeur)",
    faux: "var(--v-faux)",
    inverifiable: "var(--v-inverif)",
  };

  Object.entries(parLocuteur)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([nom, s]) => {
      const row = document.createElement("div");
      row.className = "stat-row";

      const title = document.createElement("div");
      title.className = "stat-name";
      title.textContent = `${nom} — ${s.total} affirmation${s.total > 1 ? "s" : ""}`;

      const bar = document.createElement("div");
      bar.className = "stat-bar";
      for (const key of ["vrai", "plutot_vrai", "trompeur", "faux", "inverifiable"]) {
        if (!s[key]) continue;
        const seg = document.createElement("span");
        seg.style.width = `${(s[key] / s.total) * 100}%`;
        seg.style.background = couleurs[key];
        seg.title = `${VERDICT_LABELS[key]} : ${s[key]}`;
        bar.appendChild(seg);
      }

      const legend = document.createElement("div");
      legend.className = "stat-legend";
      legend.innerHTML = ["vrai", "plutot_vrai", "trompeur", "faux", "inverifiable"]
        .filter((k) => s[k])
        .map((k) => `<span><b>${s[k]}</b> ${VERDICT_LABELS[k].toLowerCase()}</span>`)
        .join("");

      row.append(title, bar, legend);
      container.appendChild(row);
    });
}
