// Configuración de Firebase (datos compartidos entre teléfonos).
// Si se deja en null la app funciona solo en el dispositivo, o usa la configuración pegada en Ajustes.
// Los valores se copian de: Consola de Firebase → Configuración del proyecto → Tus apps → App web.
window.FIREBASE_CONFIG = null;
/* Ejemplo:
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "mi-perfumeria.firebaseapp.com",
  projectId: "mi-perfumeria",
  appId: "1:123456789:web:abc123"
};
*/

// Configuración pegada desde Ajustes → "Compartir datos entre teléfonos"
if (!window.FIREBASE_CONFIG) {
  try {
    const guardada = JSON.parse(localStorage.getItem('perfumeria_firebase'));
    if (guardada && guardada.apiKey) window.FIREBASE_CONFIG = guardada;
  } catch (e) { /* sin configuración */ }
}
