/* ══════════════════════════════════════════════════════════════════════
   LUAN AQUA — Cloud Functions
   ══════════════════════════════════════════════════════════════════════
   Gestión de asesores que requiere permisos de administrador de Firebase:
   restablecer contraseña y eliminar cuenta por completo (Auth + Firestore).

   Por qué existen como Cloud Functions y no en el frontend:
   El navegador (cliente) nunca puede cambiar la contraseña ni borrar la
   cuenta de OTRO usuario — eso solo lo puede hacer un backend con el
   Admin SDK. Estas funciones corren en el servidor de Google y verifican
   manualmente el token de sesión del administrador antes de actuar.

   NOTA TÉCNICA: se usa onRequest + verificación manual del token (en vez
   de onCall automático) porque, en pruebas, onCall no estaba entregando
   el contexto de autenticación de forma confiable con la combinación de
   SDKs usada en el frontend. Esta versión con onRequest + fetch manual
   desde el cliente es la que quedó funcionando en producción.

   REDESPLEGAR TRAS UN CAMBIO:
   1. Edita este archivo
   2. Desde una terminal con Firebase CLI (local o Cloud Shell):
        cd functions
        firebase deploy --only functions
   ══════════════════════════════════════════════════════════════════════ */

const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

function _setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function _verificarAdminDesdeToken(req) {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    const err = new Error("Debes iniciar sesión.");
    err.status = 401;
    throw err;
  }
  const idToken = match[1];
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    const err = new Error("Token inválido o expirado. Vuelve a iniciar sesión.");
    err.status = 401;
    throw err;
  }
  const perfil = await admin.firestore().collection("usuarios").doc(decoded.uid).get();
  if (!perfil.exists || perfil.data().esAdmin !== true) {
    const err = new Error("Solo el administrador puede hacer esto.");
    err.status = 403;
    throw err;
  }
  return decoded;
}

// ── 1. Restablecer contraseña de un asesor ─────────────────────────────
exports.resetAsesorPassword = onRequest(async (req, res) => {
  _setCors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    await _verificarAdminDesdeToken(req);
    const body = req.body && req.body.data ? req.body.data : req.body || {};
    const { uid, nuevaPassword } = body;

    if (!uid || typeof uid !== "string") {
      res.status(400).json({ error: "Falta el uid del asesor." }); return;
    }
    if (!nuevaPassword || nuevaPassword.length < 6) {
      res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." }); return;
    }

    const perfilObjetivo = await admin.firestore().collection("usuarios").doc(uid).get();
    if (!perfilObjetivo.exists) {
      res.status(404).json({ error: "No existe un asesor con ese uid." }); return;
    }
    if (perfilObjetivo.data().esAdmin === true) {
      res.status(403).json({ error: "No se puede resetear la contraseña de una cuenta admin desde aquí." }); return;
    }

    await admin.auth().updateUser(uid, { password: nuevaPassword });
    res.status(200).json({ result: { ok: true } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Error interno." });
  }
});

// ── 2. Eliminar asesor por completo (Auth + Firestore) ─────────────────
exports.eliminarAsesorCompleto = onRequest(async (req, res) => {
  _setCors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    await _verificarAdminDesdeToken(req);
    const body = req.body && req.body.data ? req.body.data : req.body || {};
    const { uid } = body;

    if (!uid || typeof uid !== "string") {
      res.status(400).json({ error: "Falta el uid del asesor." }); return;
    }

    const perfilObjetivo = await admin.firestore().collection("usuarios").doc(uid).get();
    if (perfilObjetivo.exists && perfilObjetivo.data().esAdmin === true) {
      res.status(403).json({ error: "No se puede eliminar una cuenta admin desde aquí." }); return;
    }

    await admin.firestore().collection("usuarios").doc(uid).delete();
    await admin.auth().deleteUser(uid).catch(() => {});
    res.status(200).json({ result: { ok: true } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Error interno." });
  }
});
