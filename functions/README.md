# Cloud Functions — Luan Aqua

Este código corre en el servidor de Google (Firebase Cloud Functions), no en el navegador. Se usa para dos acciones que solo un administrador puede hacer y que requieren permisos especiales:

- **resetAsesorPassword** — cambia la contraseña de un asesor sin necesidad de saber la anterior.
- **eliminarAsesorCompleto** — elimina el acceso de un asesor por completo (perfil + cuenta de login).

## Cómo desplegar un cambio

1. Edita `index.js`.
2. Necesitas Firebase CLI. Si no tienes Node.js instalado localmente, puedes usar **Google Cloud Shell** (terminal en el navegador, sin instalar nada en tu compu):
   - Ve a [console.cloud.google.com](https://console.cloud.google.com), selecciona el proyecto `luan-aqua`.
   - Abre Cloud Shell (ícono `>_` arriba a la derecha).
   - `npm install -g firebase-tools`
   - `firebase login --no-localhost`
   - `mkdir luan-aqua-functions && cd luan-aqua-functions`
   - `firebase init functions` (elige "Use an existing project" → `luan-aqua`, lenguaje JavaScript, sin ESLint)
   - Reemplaza el contenido de `functions/index.js` que se generó con el `index.js` de esta carpeta.
   - `firebase deploy --only functions`

## Notas técnicas

- Las funciones usan `onRequest` (no `onCall`) con verificación manual del token de sesión, porque `onCall` no estaba recibiendo el contexto de autenticación de forma confiable con la combinación de SDKs usada en el frontend (`luan_aqua_pedidos.html`).
- El frontend llama a estas funciones a través de la función helper `_llamarFuncion()` dentro de `luan_aqua_pedidos.html`, que obtiene el token con `auth.currentUser.getIdToken()` y lo envía manualmente en el header `Authorization`.
- Requiere el proyecto en plan **Blaze** (pago por uso) de Firebase — con el volumen de uso esperado, el costo real es $0.00 (dentro de la capa gratuita).
