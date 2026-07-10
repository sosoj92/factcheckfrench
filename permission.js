// permission.js — demande l'autorisation micro pour l'origine de l'extension.
// Une fois accordée ici (dans un onglet), le panneau latéral peut utiliser
// la reconnaissance vocale sans nouvelle demande.

const status = document.getElementById("status");

document.getElementById("ask").addEventListener("click", async () => {
  status.textContent = "Demande en cours… acceptez la fenêtre de Chrome.";
  status.className = "";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // On coupe immédiatement : seul le droit d'accès nous intéresse.
    stream.getTracks().forEach((t) => t.stop());
    status.textContent = "✓ Micro autorisé ! Retournez dans le panneau Véridique et relancez l'écoute. Cet onglet va se fermer.";
    status.className = "ok";
    setTimeout(() => window.close(), 2500);
  } catch (e) {
    status.className = "err";
    if (e.name === "NotAllowedError") {
      status.textContent = "✗ Autorisation refusée. Suivez les étapes ci-dessous pour l'activer manuellement.";
    } else if (e.name === "NotFoundError") {
      status.textContent = "✗ Aucun microphone détecté sur cet appareil.";
    } else {
      status.textContent = `✗ Erreur : ${e.message}`;
    }
  }
});
