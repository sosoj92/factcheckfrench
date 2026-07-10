// background.js — Service worker (Manifest V3)
// Rôles : ouvrir le panneau latéral, menu contextuel "Vérifier ce passage",
// et relayer les demandes de vérification vers le panneau.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "veridique-check-selection",
    title: "Véridique : vérifier « %s »",
    contexts: ["selection"],
  });
  // Ouvrir le panneau latéral au clic sur l'icône
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

// File d'attente si le panneau n'est pas encore ouvert
let pendingSelection = null;

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "veridique-check-selection" || !info.selectionText) return;

  const texte = info.selectionText.trim().slice(0, 4000);

  // Ouvrir le panneau latéral sur l'onglet courant
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    // ignore : peut échouer si déjà ouvert
  }

  // Tenter d'envoyer directement ; sinon stocker pour quand le panneau se connecte
  chrome.runtime
    .sendMessage({ type: "CHECK_SELECTION", texte })
    .catch(() => {
      pendingSelection = texte;
    });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SIDEPANEL_READY") {
    if (pendingSelection) {
      sendResponse({ pendingSelection });
      pendingSelection = null;
    } else {
      sendResponse({});
    }
    return true;
  }
});
