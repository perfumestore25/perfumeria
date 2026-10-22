'use strict';
/*
 * Sincronización con Firebase (Firestore + Auth) para usar la app en varios teléfonos.
 * Cada registro es un documento: usuarios, insumos, referencias, clientes, proveedores, compras, ventas
 * y config/general. Los movimientos de stock van en insumos/{id}/movimientos.
 * Firestore guarda una copia local, así que la app sigue funcionando sin internet y sube los cambios al volver.
 * Si FIREBASE_CONFIG es null todas las funciones de `nube` no hacen nada (modo solo dispositivo).
 */

const COLECCIONES = ['usuarios', 'insumos', 'referencias', 'armados', 'clientes', 'proveedores', 'compras', 'ventas', 'gastos'];
const CON_VENTANA = ['ventas', 'gastos']; // crecen todos los días: solo se sincronizan los recientes

const NUBE = {
  activa: !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && window.firebase),
  fs: null,
  auth: null,
  listo: false,
  recibidas: new Set(),     // colecciones que ya entregaron su primera lectura
  // ventas y gastos anteriores a la ventana sincronizada, cargados al pedir reportes viejos
  historico: { ventas: new Map(), gastos: new Map() },
  historicoDesde: null,     // fecha desde la que hay ventas y gastos en memoria
  cargandoHist: false,
  desuscribir: [],
};

const inc = n => firebase.firestore.FieldValue.increment(n);

// Escrituras. Todas son "dispara y olvida": Firestore las aplica en la copia local al instante y las sube cuando hay red.
const nube = {
  agregar(col, obj) {
    if (!NUBE.activa) return;
    NUBE.fs.collection(col).doc(obj.id).set(limpiar(obj)).catch(errorNube);
  },
  // Reemplaza un registro existente. En insumos nunca se escribe `stock` (solo cambia con incrementos)
  put(col, obj) {
    if (!NUBE.activa) return;
    const datos = limpiar(obj);
    const ref = NUBE.fs.collection(col).doc(obj.id);
    if (col === 'insumos') { delete datos.stock; ref.update(datos).catch(errorNube); }
    else ref.set(datos).catch(errorNube);
  },
  quitar(col, id) {
    if (!NUBE.activa) return;
    NUBE.fs.collection(col).doc(id).delete().catch(errorNube);
  },
  config(campos) {
    if (!NUBE.activa) return;
    NUBE.fs.collection('config').doc('general').set(limpiar(campos), { merge: true }).catch(errorNube);
  },
  contadorVentas() {
    if (!NUBE.activa) return;
    NUBE.fs.collection('config').doc('general').set({ consecutivo: inc(1) }, { merge: true }).catch(errorNube);
  },
  // Suma/resta stock con incremento atómico, así dos teléfonos vendiendo a la vez no se pisan
  stock(insumoId, cantidad, movimiento) {
    if (!NUBE.activa) return;
    const ref = NUBE.fs.collection('insumos').doc(insumoId);
    ref.update({ stock: inc(cantidad) }).catch(errorNube);
    ref.collection('movimientos').doc(movimiento.id).set(limpiar(movimiento)).catch(errorNube);
  },
};

const limpiar = obj => JSON.parse(JSON.stringify(obj)); // quita undefined y funciones

function errorNube(e) {
  console.error(e);
  if (String(e.code).includes('permission-denied')) toast('Sin permiso en la nube: revisa la cuenta del negocio');
}

// ---------------------------------------------------------------- arranque
function nubeIniciar() {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  NUBE.fs = firebase.firestore();
  NUBE.fs.settings({ ignoreUndefinedProperties: true });
  NUBE.fs.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('Sin caché local:', e.code));
  NUBE.auth = firebase.auth();

  pantallaCarga('Conectando…');
  NUBE.auth.onAuthStateChanged(user => {
    detenerEscuchas();
    if (!user) return renderConectar();
    escuchar();
  });

  const estado = () => document.body.classList.toggle('sin-red', !navigator.onLine);
  window.addEventListener('online', estado);
  window.addEventListener('offline', estado);
  estado();
}

function pantallaCarga(msg) {
  document.body.classList.add('login');
  $('#app').innerHTML = `<div class="login-box"><img class="logo" src="logo.png" alt=""><h1>${esc(db.config.negocio)}</h1><p>${esc(msg)}</p></div>`;
}

// Primer paso en cada teléfono: iniciar sesión con la cuenta del negocio (una sola vez)
function renderConectar() {
  document.body.classList.add('login');
  $('#app').innerHTML = `
    <div class="login-box">
      <img class="logo" src="logo.png" alt="">
      <h1>Conectar este teléfono</h1>
      <p>Ingresa la cuenta del negocio. Solo se hace una vez en cada teléfono.</p>
      <form id="f-conectar">
        ${campo('Correo del negocio', 'email', '', 'type="email" autocomplete="username" autocapitalize="none" required')}
        ${campo('Contraseña', 'clave', '', 'type="password" autocomplete="current-password" required')}
        <button class="btn primary block grande">Conectar</button>
      </form>
    </div>`;
  $('#f-conectar').onsubmit = e => {
    e.preventDefault();
    const d = datosForm(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    NUBE.auth.signInWithEmailAndPassword(d.email.trim(), d.clave).catch(err => {
      btn.disabled = false;
      toast(err.code === 'auth/network-request-failed' ? 'Sin conexión a internet' : 'Correo o contraseña incorrectos');
    });
  };
}

function desconectarDispositivo() {
  if (!confirm('Este teléfono dejará de estar conectado a los datos del negocio. ¿Continuar?')) return;
  localStorage.removeItem(KEY_SES);
  NUBE.auth.signOut().then(() => location.reload());
}

// Inicio de la ventana de ventas que se mantiene sincronizada: desde el 1.º del mes anterior
function inicioVentana() {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth() - 1, 1);
}

function escuchar() {
  pantallaCarga('Sincronizando datos…');
  NUBE.listo = false;
  NUBE.recibidas.clear();
  NUBE.historicoDesde = inicioVentana();

  const listo = () => {
    if (NUBE.listo || NUBE.recibidas.size < COLECCIONES.length + 1) return;
    NUBE.listo = true;
    iniciar();
  };

  NUBE.desuscribir.push(NUBE.fs.collection('config').doc('general').onSnapshot({ includeMetadataChanges: true }, snap => {
    if (!snap.exists) {
      if (snap.metadata.fromCache) return pantallaCarga('Conéctate a internet para la primera sincronización…');
      return sembrarNube();
    }
    db.config = { ...dbInicial().config, ...snap.data() };
    NUBE.recibidas.add('config');
    listo();
    refrescar();
  }, errorEscucha));

  for (const col of COLECCIONES) {
    let q = NUBE.fs.collection(col);
    if (CON_VENTANA.includes(col)) q = q.where('fecha', '>=', NUBE.historicoDesde.toISOString());
    NUBE.desuscribir.push(q.onSnapshot(snap => {
      db[col] = snap.docs.map(d => d.data());
      if (col === 'usuarios' && sesion) {
        sesion = byId(db.usuarios, sesion.id) || null;
        if (!sesion || !sesion.activo) { salir(); return; }
      }
      NUBE.recibidas.add(col);
      listo();
      refrescar();
    }, errorEscucha));
  }
}

function detenerEscuchas() {
  NUBE.desuscribir.forEach(f => f());
  NUBE.desuscribir = [];
}

function errorEscucha(e) {
  console.error(e);
  if (e.code === 'permission-denied') {
    pantallaCarga('Esta cuenta no tiene permiso para ver los datos. Revisa las reglas de Firestore.');
    setTimeout(() => NUBE.auth.signOut(), 4000);
  }
}

// Primera vez que se usa la nube: crea configuración, supervisor e insumos base (una sola vez, con transacción)
function sembrarNube() {
  const semilla = dbInicial();
  const cfgRef = NUBE.fs.collection('config').doc('general');
  NUBE.fs.runTransaction(async t => {
    const actual = await t.get(cfgRef);
    if (actual.exists) return;
    t.set(cfgRef, semilla.config);
    for (const u of semilla.usuarios) t.set(NUBE.fs.collection('usuarios').doc(u.id), u);
    for (const i of semilla.insumos) t.set(NUBE.fs.collection('insumos').doc(i.id), i);
  }).catch(errorNube);
}

// Al llegar cambios de otro teléfono se redibuja, salvo si el usuario está escribiendo o tiene un formulario abierto
let renderPendiente = false;
function refrescar() {
  if (!NUBE.listo || !sesion) return;
  clearTimeout(refrescar._t);
  refrescar._t = setTimeout(() => {
    const ocupado = $('#modal').classList.contains('abierto') || vistaActual() === 'vender' ||
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (ocupado) { renderPendiente = true; return; }
    renderPendiente = false;
    rerender();
  }, 250);
}

// ---------------------------------------------------------------- lecturas bajo demanda
// Si un reporte pide ventas o gastos anteriores a la ventana sincronizada, se traen una vez y se guardan en memoria
function asegurarHistorico(ini) {
  if (!NUBE.activa || !NUBE.historicoDesde || ini >= NUBE.historicoDesde || NUBE.cargandoHist) return;
  NUBE.cargandoHist = true;
  const hasta = NUBE.historicoDesde;
  Promise.all(CON_VENTANA.map(col =>
    NUBE.fs.collection(col).where('fecha', '>=', ini.toISOString()).where('fecha', '<', hasta.toISOString()).get()
      .then(s => s.forEach(d => NUBE.historico[col].set(d.id, d.data())))))
    .then(() => { NUBE.historicoDesde = ini; })
    .catch(() => toast('Sin conexión: no se pudieron traer datos anteriores'))
    .finally(() => { NUBE.cargandoHist = false; rerender(); });
}

async function ventasDeCliente(id) {
  if (!NUBE.activa) return db.ventas.filter(v => v.clienteId === id);
  const s = await NUBE.fs.collection('ventas').where('clienteId', '==', id).get();
  return s.docs.map(d => d.data());
}

async function movimientosDe(insumoId) {
  if (!NUBE.activa) return db.movimientos.filter(m => m.insumoId === insumoId).slice(-40).reverse();
  const s = await NUBE.fs.collection('insumos').doc(insumoId).collection('movimientos').orderBy('fecha', 'desc').limit(40).get();
  return s.docs.map(d => d.data());
}

// Respaldo completo (incluye todas las ventas y movimientos, no solo los sincronizados)
async function datosCompletos() {
  if (!NUBE.activa) return db;
  const out = { version: 1, config: db.config, movimientos: [] };
  for (const col of COLECCIONES) out[col] = (await NUBE.fs.collection(col).get({ source: 'server' })).docs.map(d => d.data());
  out.movimientos = (await NUBE.fs.collectionGroup('movimientos').get({ source: 'server' })).docs.map(d => d.data());
  return out;
}

// Sube un respaldo (o los datos que el teléfono tenía antes de usar la nube). Combina con lo que ya existe.
async function subirANube(datos) {
  const ops = [];
  // La nube arranca con un admin y productos base; si los datos que se suben traen los suyos
  // (mismo usuario, o mismo tipo y nombre de producto sin stock), se borran los de la nube para no duplicarlos
  const claveU = u => String(u.usuario).toLowerCase();
  const claveI = i => `${i.tipo}|${String(i.nombre).trim().toLowerCase()}`;
  const ids = col => new Set((datos[col] || []).map(x => x.id));
  const claves = (col, f) => new Set((datos[col] || []).map(f));
  const idsU = ids('usuarios'), clU = claves('usuarios', claveU);
  const idsI = ids('insumos'), clI = claves('insumos', claveI);
  for (const u of db.usuarios) if (!idsU.has(u.id) && clU.has(claveU(u))) ops.push(b => b.delete(NUBE.fs.collection('usuarios').doc(u.id)));
  for (const i of db.insumos) if (!idsI.has(i.id) && clI.has(claveI(i)) && !Number(i.stock)) ops.push(b => b.delete(NUBE.fs.collection('insumos').doc(i.id)));
  ops.push(b => b.set(NUBE.fs.collection('config').doc('general'), limpiar(datos.config), { merge: true }));
  for (const col of COLECCIONES) for (const x of datos[col] || []) ops.push(b => b.set(NUBE.fs.collection(col).doc(x.id), limpiar(x)));
  for (const m of datos.movimientos || []) {
    if (m.insumoId) ops.push(b => b.set(NUBE.fs.collection('insumos').doc(m.insumoId).collection('movimientos').doc(m.id), limpiar(m)));
  }
  for (let i = 0; i < ops.length; i += 400) {
    const b = NUBE.fs.batch();
    ops.slice(i, i + 400).forEach(op => op(b));
    await b.commit();
  }
  return ops.length;
}

// Llamado por la app Android cuando descargó una versión nueva
window.hayActualizacion = () => {
  const aviso = document.createElement('div');
  aviso.className = 'aviso actualizacion';
  aviso.innerHTML = '✨ Hay una versión nueva de la app. <a onclick="location.reload()">Toca aquí para actualizar</a>.';
  document.body.appendChild(aviso);
};
