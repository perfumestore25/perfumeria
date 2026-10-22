// Configuración de Firebase (datos compartidos entre teléfonos).
// Si se deja en null la app funciona solo en el dispositivo, o usa la configuración pegada en Ajustes.
// Los valores se copian de: Consola de Firebase → Configuración del proyecto → Tus apps → App web.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAkYZKY29bmBTTlBvErVisWThTiay5YmMc",
  authDomain: "perfumestore-a4321.firebaseapp.com",
  projectId: "perfumestore-a4321",
  storageBucket: "perfumestore-a4321.firebasestorage.app",
  messagingSenderId: "867614737148",
  appId: "1:867614737148:web:57d9861025f7b042d6cd79"
};

// Configuración pegada desde Ajustes → "Compartir datos entre teléfonos"
if (!window.FIREBASE_CONFIG) {
  try {
    const guardada = JSON.parse(localStorage.getItem('perfumeria_firebase'));
    if (guardada && guardada.apiKey) window.FIREBASE_CONFIG = guardada;
  } catch (e) { /* sin configuración */ }
}
