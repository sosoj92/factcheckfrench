// options.js — chargement / sauvegarde des réglages + test de la clé.

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get({
    apiKey: "",
    model: "claude-sonnet-4-6",
    maxSearches: 3,
    demoMode: false,
  });
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("maxSearches").value = String(s.maxSearches);
  $("demoMode").checked = s.demoMode;
}

async function save() {
  const apiKey = $("apiKey").value.trim();
  const model = $("model").value;
  const maxSearches = Number($("maxSearches").value);
  const demoMode = $("demoMode").checked;
  const status = $("status");

  await chrome.storage.local.set({ apiKey, model, maxSearches, demoMode });

  if (!apiKey) {
    status.textContent = "Réglages enregistrés (aucune clé fournie).";
    status.className = "ok";
    return;
  }

  status.textContent = "Réglages enregistrés. Test de la clé en cours…";
  status.className = "";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 10,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (r.ok) {
      status.textContent = "✓ Clé valide. Tout est prêt !";
      status.className = "ok";
    } else {
      const err = await r.json().catch(() => ({}));
      status.textContent = `✗ ${err?.error?.message || "Clé invalide ou modèle indisponible (" + r.status + ")."}`;
      status.className = "err";
    }
  } catch (e) {
    status.textContent = "✗ Impossible de joindre l'API. Vérifiez votre connexion.";
    status.className = "err";
  }
}

$("save").addEventListener("click", save);
load();
