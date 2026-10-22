'use strict';
/*
 * Perfumería — inventario de insumos (esencias, alcohol, fijador, frascos),
 * referencias, ventas con obsequios, clientes, proveedores y reportes.
 * Los datos se guardan en el dispositivo (localStorage) o, si hay FIREBASE_CONFIG, en la nube
 * compartida entre teléfonos (ver nube.js). En ambos casos funciona sin conexión.
 */

const KEY_DB = 'perfumeria_db_v1';
const KEY_SES = 'perfumeria_sesion';
const NATIVO = window.Android || null; // puente con la app Android (MainActivity.kt)

const TIPOS = {
  esencia: { label: 'Esencias', unidad: 'ml' },
  alcohol: { label: 'Alcohol', unidad: 'ml' },
  fijador: { label: 'Fijador', unidad: 'ml' },
  frasco: { label: 'Frascos', unidad: 'und' },
  otro: { label: 'Otros / empaques', unidad: 'und' },
};
const METODOS = ['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Tarjeta'];
const CATEGORIAS_GASTO = ['Arriendo', 'Servicios públicos', 'Nómina / sueldos', 'Transporte / domicilios', 'Publicidad',
  'Mantenimiento', 'Impuestos', 'Aseo y papelería', 'Otros'];
const TIPOS_INGRESO = ['Compra a proveedor', 'Inventario inicial', 'Devolución', 'Otro ingreso'];
const GENEROS = ['Femenino', 'Masculino', 'Unisex'];
const R_TODOS = ['supervisor', 'vendedor'];
const R_SUP = ['supervisor'];

// ---------------------------------------------------------------- utilidades
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const fmtMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const money = n => fmtMoney.format(Math.round(n || 0));
const moneyU = n => '$ ' + (Math.round((n || 0) * 100) / 100).toLocaleString('es-CO'); // costos unitarios con decimales
const fmtNum = n => (Math.round((n || 0) * 100) / 100).toLocaleString('es-CO');
const fechaHora = iso => new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
const hora = iso => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
const fechaCorta = d => new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
const isoDia = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const parseDia = s => { const [y, m, d] = String(s).split('-').map(Number); return y ? new Date(y, m - 1, d) : new Date(new Date().setHours(0, 0, 0, 0)); };
const byId = (arr, id) => arr.find(x => x.id === id);
const porNombre = (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es');
const datosForm = f => Object.fromEntries(new FormData(f));

function hashPin(pin) {
  let h = 0x811c9dc5;
  const s = 'perfumeria:' + pin;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('visible'), 2400);
}

// Archivos, impresión y compartir: usa el puente nativo en Android, o el navegador si no existe
function descargar(nombre, contenido, mime) {
  if (NATIVO?.guardarArchivo) { NATIVO.guardarArchivo(nombre, contenido, mime); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contenido], { type: mime }));
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function imprimir(titulo) {
  if (NATIVO?.imprimir) NATIVO.imprimir(titulo || 'Reporte');
  else window.print();
}
function compartirTexto(texto) {
  if (NATIVO?.compartirTexto) NATIVO.compartirTexto(texto);
  else if (navigator.share) navigator.share({ text: texto }).catch(() => {});
  else { navigator.clipboard?.writeText(texto); toast('Copiado al portapapeles'); }
}

// ---------------------------------------------------------------- base de datos
function dbInicial() {
  const alcoholId = uid(), fijadorId = uid();
  return {
    version: 1,
    config: {
      negocio: 'Perfumes Store', nit: '', telefono: '', mensajeRecibo: '¡Gracias por tu compra!',
      pctEsencia: 30, pctFijador: 5, alcoholId, fijadorId, consecutivo: 0, ultimoRespaldo: null,
    },
    usuarios: [{ id: uid(), nombre: 'Supervisor', usuario: 'admin', pin: hashPin('1234'), rol: 'supervisor', activo: true, debeCambiarPin: true }],
    insumos: [
      { id: alcoholId, codigo: 'AL-001', tipo: 'alcohol', nombre: 'Alcohol para perfumería', unidad: 'ml', stock: 0, stockMin: 2000, costo: 0, activo: true },
      { id: fijadorId, codigo: 'FJ-001', tipo: 'fijador', nombre: 'Fijador', unidad: 'ml', stock: 0, stockMin: 200, costo: 0, activo: true },
      { id: uid(), codigo: 'FR-001', tipo: 'frasco', nombre: 'Frasco 30 ml', unidad: 'und', capacidad: 30, stock: 0, stockMin: 10, costo: 0, precioVenta: 25000, activo: true },
      { id: uid(), codigo: 'FR-002', tipo: 'frasco', nombre: 'Frasco 50 ml', unidad: 'und', capacidad: 50, stock: 0, stockMin: 10, costo: 0, precioVenta: 35000, activo: true },
      { id: uid(), codigo: 'FR-003', tipo: 'frasco', nombre: 'Frasco 100 ml', unidad: 'und', capacidad: 100, stock: 0, stockMin: 10, costo: 0, precioVenta: 55000, activo: true },
    ],
    referencias: [], armados: [], clientes: [], proveedores: [], compras: [], ventas: [], gastos: [], movimientos: [],
  };
}

function migrar(d) {
  const base = dbInicial();
  for (const k of Object.keys(base)) if (d[k] === undefined) d[k] = base[k];
  d.config = { ...base.config, ...d.config };
  return d;
}

// Códigos automáticos de productos: ES-001 esencias, AL alcohol, FJ fijador, FR frascos, OT otros
const PREFIJOS = { esencia: 'ES', alcohol: 'AL', fijador: 'FJ', frasco: 'FR', otro: 'OT' };
function generarCodigo(lista, prefijo) {
  const n = lista.reduce((m, x) => {
    const c = String(x.codigo || '').toUpperCase();
    return c.startsWith(prefijo) ? Math.max(m, parseInt(c.replace(/\D/g, '')) || 0) : m;
  }, 0) + 1;
  return `${prefijo}-${String(n).padStart(3, '0')}`;
}
const codigoInsumo = tipo => generarCodigo(db.insumos, PREFIJOS[tipo] || 'OT');
const codigoArmado = () => generarCodigo(db.armados, 'PA');
// Da código a los productos creados antes de que existieran los códigos
function asegurarCodigos() {
  if (!esSup()) return;
  for (const i of [...db.insumos].sort((a, b) => porNombre(a, b))) {
    if (i.codigo) continue;
    i.codigo = codigoInsumo(i.tipo);
    nube.put('insumos', i);
  }
  guardar();
}

function cargarDB() {
  try {
    const raw = localStorage.getItem(KEY_DB);
    if (raw) return migrar(JSON.parse(raw));
  } catch (e) { console.error(e); }
  const nueva = dbInicial();
  localStorage.setItem(KEY_DB, JSON.stringify(nueva));
  return nueva;
}

// En modo nube los datos llegan desde Firestore (nube.js → escuchar)
let db = NUBE.activa ? { ...dbInicial(), usuarios: [], insumos: [] } : cargarDB();
let sesion = null;

// Guarda en el teléfono (modo solo dispositivo). En modo nube cada cambio se sube con nube.agregar/put/stock.
function guardar() {
  if (NUBE.activa) return;
  try { localStorage.setItem(KEY_DB, JSON.stringify(db)); }
  catch (e) { alert('No se pudieron guardar los datos: ' + e.message); }
}

const esSup = () => sesion?.rol === 'supervisor';
const activos = tipo => db.insumos.filter(i => i.tipo === tipo && i.activo !== false).sort((a, b) => (num(a.capacidad) - num(b.capacidad)) || porNombre(a, b));
const bajo = i => i.activo !== false && num(i.stockMin) > 0 && i.stock <= num(i.stockMin);
const nombreCliente = id => byId(db.clientes, id)?.nombre || 'Cliente general';
const nombreUsuario = id => byId(db.usuarios, id)?.nombre || '—';
const clientesOrdenados = () => [...db.clientes].sort(porNombre);

function moverStock(insumoId, cantidad, tipo, ref, nota = '') {
  const i = byId(db.insumos, insumoId);
  if (!i) return;
  i.stock = Math.round((num(i.stock) + cantidad) * 1000) / 1000;
  const m = { id: uid(), fecha: new Date().toISOString(), insumoId, cantidad, saldo: i.stock, tipo, ref, nota, userId: sesion?.id };
  if (NUBE.activa) nube.stock(insumoId, cantidad, m);
  else db.movimientos.push(m);
}

// Porcentajes de mezcla: los de la referencia o los generales
function pctsRef(ref) {
  const pE = ref.pctEsencia === null || ref.pctEsencia === undefined || ref.pctEsencia === '' ? db.config.pctEsencia : ref.pctEsencia;
  const pF = ref.pctFijador === null || ref.pctFijador === undefined || ref.pctFijador === '' ? db.config.pctFijador : ref.pctFijador;
  return { pE: num(pE), pF: num(pF) };
}

// Insumos que consume armar `cant` perfumes de una referencia en un frasco.
// `mezcla` ({pE, pA, pF}) viene de un perfume armado; si no, se usan los % de la referencia o los generales.
function consumoPerfume(ref, frasco, cant, mezcla) {
  const C = num(frasco.capacidad);
  const { pE, pF } = mezcla || pctsRef(ref);
  const esencia = C * pE / 100 * cant, fijador = C * pF / 100 * cant;
  const alcohol = mezcla ? C * num(mezcla.pA) / 100 * cant : C * cant - esencia - fijador;
  const m = {};
  const add = (id, q) => { if (id && q > 0) m[id] = (m[id] || 0) + q; };
  add(ref.esenciaId, esencia);
  add(db.config.fijadorId, fijador);
  add(db.config.alcoholId, alcohol);
  add(frasco.id, cant);
  return m;
}
const costoConsumo = m => Object.entries(m).reduce((s, [id, q]) => s + q * num(byId(db.insumos, id)?.costo), 0);
const precioPerfume = (ref, frasco) => num(ref.precios?.[frasco.id]) > 0 ? num(ref.precios[frasco.id]) : num(frasco.precioVenta);
function alcance(ref, frasco) {
  const es = byId(db.insumos, ref.esenciaId);
  const porUnidad = num(frasco.capacidad) * pctsRef(ref).pE / 100;
  return porUnidad > 0 ? Math.floor(Math.max(0, num(es?.stock)) / porUnidad) : 0;
}

function rango(tipo, base) {
  const d = new Date(base); d.setHours(0, 0, 0, 0);
  let ini = new Date(d), fin;
  if (tipo === 'dia') { fin = new Date(d); fin.setDate(fin.getDate() + 1); }
  else if (tipo === 'semana') { ini.setDate(d.getDate() - (d.getDay() + 6) % 7); fin = new Date(ini); fin.setDate(ini.getDate() + 7); }
  else { ini = new Date(d.getFullYear(), d.getMonth(), 1); fin = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  return { tipo, ini, fin };
}
function etiquetaRango(r) {
  if (r.tipo === 'dia') return new Date(r.ini).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (r.tipo === 'semana') return `Semana del ${fechaCorta(r.ini)} al ${fechaCorta(new Date(r.fin - 1))}`;
  const t = new Date(r.ini).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const ventasVistas = new Map(); // ventas traídas al ver el historial de un cliente
const buscarVenta = id => byId(db.ventas, id) || NUBE.historico.ventas.get(id) || ventasVistas.get(id);
// Registros (ventas o gastos) de un periodo; en modo nube trae los anteriores a la ventana sincronizada
function registrosEn(col, { ini, fin }, userId) {
  asegurarHistorico(ini);
  const hist = NUBE.historico[col];
  const todos = hist.size ? [...hist.values(), ...db[col]] : db[col];
  return todos.filter(x => {
    const f = new Date(x.fecha);
    return f >= ini && f < fin && (!userId || x.userId === userId);
  });
}
const ventasEn = (r, userId, incluirAnuladas = false) => registrosEn('ventas', r, userId).filter(v => incluirAnuladas || !v.anulada);
const gastosEn = (r, userId) => registrosEn('gastos', r, userId);

// ---------------------------------------------------------------- UI genérica
function modal(titulo, html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card"><div class="modal-head"><h2>${esc(titulo)}</h2><button class="icon-btn" onclick="cerrarModal()" aria-label="Cerrar">✕</button></div><div class="modal-body">${html}</div></div>`;
  m.classList.add('abierto');
  document.body.classList.add('con-modal');
  return m;
}
function cerrarModal() {
  const m = $('#modal');
  m.classList.remove('abierto');
  m.innerHTML = '';
  document.body.classList.remove('con-modal');
  if (renderPendiente) { renderPendiente = false; rerender(); } // cambios que llegaron de otro teléfono
}
// Modal con formulario. Si alGuardar devuelve false el modal sigue abierto.
function formModal(titulo, campos, alGuardar, extraBotones = '') {
  modal(titulo, `<form id="fm" autocomplete="off">${campos}<div class="acciones">${extraBotones}<button class="btn primary">Guardar</button></div></form>`);
  const f = $('#fm');
  f.onsubmit = e => {
    e.preventDefault();
    if (alGuardar(datosForm(f), f) !== false) cerrarModal();
  };
  return f;
}
const campo = (label, name, val = '', attrs = '') => `<label>${label}<input name="${name}" value="${esc(val)}" ${attrs}></label>`;
const area = (label, name, val = '') => `<label>${label}<textarea name="${name}" rows="2">${esc(val)}</textarea></label>`;
const selector = (label, name, opts, val, attrs = '') =>
  `<label>${label}<select name="${name}" ${attrs}>${opts.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(val ?? '') ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>`;
const casilla = (label, name, marcado) => `<label class="check"><input type="checkbox" name="${name}" ${marcado ? 'checked' : ''}> ${label}</label>`;
const vacio = txt => `<li class="muted">${txt}</li>`;

function opcionesInsumos(sel) {
  return Object.entries(TIPOS).map(([k, t]) => {
    const its = db.insumos.filter(i => i.tipo === k && i.activo !== false).sort(porNombre);
    return its.length ? `<optgroup label="${t.label}">${its.map(i => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${i.codigo ? esc(i.codigo) + ' · ' : ''}${esc(i.nombre)} (${fmtNum(i.stock)} ${i.unidad})</option>`).join('')}</optgroup>` : '';
  }).join('');
}

// ---------------------------------------------------------------- sesión y navegación
const VISTAS = {
  inicio: { titulo: 'Inicio', icon: '🏠', roles: R_TODOS, render: vInicio },
  vender: { titulo: 'Nueva venta', corto: 'Vender', icon: '🛒', roles: R_TODOS, render: vVender, despues: despuesVender },
  ventas: { titulo: 'Ventas', icon: '🧾', roles: R_TODOS, render: vVentas },
  inventario: { titulo: 'Inventario', icon: '📦', roles: R_TODOS, render: vInventario },
  referencias: { titulo: 'Referencias', icon: '🧴', roles: R_TODOS, render: vReferencias },
  armados: { titulo: 'Perfumes armados', icon: '⭐', roles: R_TODOS, render: vArmados },
  compras: { titulo: 'Ingreso de inventario', icon: '📥', roles: R_SUP, render: vCompras },
  gastos: { titulo: 'Gastos', icon: '💸', roles: R_TODOS, render: vGastos },
  clientes: { titulo: 'Clientes', icon: '👥', roles: R_TODOS, render: vClientes },
  proveedores: { titulo: 'Proveedores', icon: '🏭', roles: R_SUP, render: vProveedores },
  reportes: { titulo: 'Reportes', icon: '📊', roles: R_TODOS, render: vReportes },
  usuarios: { titulo: 'Usuarios', icon: '🔐', roles: R_SUP, render: vUsuarios },
  ajustes: { titulo: 'Ajustes y respaldo', icon: '⚙️', roles: R_SUP, render: vAjustes },
};

function usuarioGuardado() {
  const id = localStorage.getItem(KEY_SES);
  const u = id && byId(db.usuarios, id);
  return u && u.activo ? u : null;
}

function renderLogin() {
  document.body.classList.add('login');
  const inicial = db.usuarios.some(u => u.usuario === 'admin' && u.debeCambiarPin);
  $('#app').innerHTML = `
    <div class="login-box">
      <img class="logo" src="logo.png" alt="Perfumes Store">
      <h1>${esc(db.config.negocio)}</h1>
      <p>Inventario y ventas</p>
      <form id="f-login">
        ${campo('Usuario', 'usuario', '', 'autocomplete="username" autocapitalize="none" required')}
        ${campo('PIN', 'pin', '', 'type="password" inputmode="numeric" autocomplete="current-password" required')}
        <button class="btn primary block grande">Ingresar</button>
      </form>
      ${inicial ? '<p class="hint">Primer ingreso: usuario <b>admin</b>, PIN <b>1234</b>. Cámbialo al entrar.</p>' : ''}
    </div>`;
  $('#f-login').onsubmit = e => {
    e.preventDefault();
    const d = datosForm(e.target);
    const u = db.usuarios.find(x => x.activo && x.usuario.toLowerCase() === d.usuario.trim().toLowerCase());
    if (!u || u.pin !== hashPin(d.pin)) return toast('Usuario o PIN incorrecto');
    localStorage.setItem(KEY_SES, u.id);
    iniciar();
  };
}

function renderShell() {
  document.body.classList.remove('login');
  const permitidas = Object.entries(VISTAS).filter(([, v]) => v.roles.includes(sesion.rol));
  $('#app').innerHTML = `
    <header class="topbar">
      <button class="icon-btn" onclick="abrirMenu()" aria-label="Menú">☰</button>
      <img class="logo-mini" src="logo-192.png" alt="">
      <h1 id="titulo"></h1>
      ${NUBE.activa ? '<span class="estado-red" title="Las ventas se guardan y se suben al volver la conexión">Sin conexión</span>' : ''}
      <span class="chip-user">${esc(sesion.nombre.split(' ')[0])} · ${esSup() ? 'Supervisor' : 'Vendedor'}</span>
    </header>
    <main id="vista"></main>
    <nav class="bottom">
      ${['inicio', 'vender', 'inventario', 'reportes'].map(v => `<a href="#${v}" data-v="${v}"><span>${VISTAS[v].icon}</span>${VISTAS[v].corto || VISTAS[v].titulo}</a>`).join('')}
      <a onclick="abrirMenu()"><span>☰</span>Más</a>
    </nav>
    <div id="drawer" class="drawer" onclick="if(event.target===this)cerrarMenu()">
      <div class="drawer-panel">
        <div class="drawer-head"><img src="logo.png" alt="${esc(db.config.negocio)}"><small>${esc(sesion.nombre)} · ${esSup() ? 'Supervisor' : 'Vendedor'}</small></div>
        ${permitidas.map(([k, v]) => `<a href="#${k}" data-v="${k}" onclick="cerrarMenu()">${v.icon} ${v.titulo}</a>`).join('')}
        <hr>
        <a onclick="cerrarMenu();cambiarMiPin()">🔑 Cambiar mi PIN</a>
        <a onclick="salir()">🚪 Cerrar sesión</a>
      </div>
    </div>`;
}
function abrirMenu() { $('#drawer')?.classList.add('abierto'); }
function cerrarMenu() { $('#drawer')?.classList.remove('abierto'); }

function vistaActual() {
  const v = location.hash.slice(1) || 'inicio';
  return VISTAS[v] && VISTAS[v].roles.includes(sesion.rol) ? v : 'inicio';
}
function render() {
  if (!sesion) return renderLogin();
  const v = vistaActual();
  $('#titulo').textContent = VISTAS[v].titulo;
  document.querySelectorAll('[data-v]').forEach(a => a.classList.toggle('activo', a.dataset.v === v));
  $('#vista').innerHTML = VISTAS[v].render();
  VISTAS[v].despues?.();
}
function ir(v) { if (location.hash === '#' + v) render(); else location.hash = v; }
function rerender() { const y = window.scrollY; render(); window.scrollTo(0, y); }

window.addEventListener('hashchange', () => { cerrarMenu(); cerrarModal(); render(); });

// Botón "atrás" de Android: cierra modal/menú, vuelve a inicio o sale de la app
window.onAndroidBack = () => {
  if ($('#modal').classList.contains('abierto')) { cerrarModal(); return true; }
  if ($('#drawer')?.classList.contains('abierto')) { cerrarMenu(); return true; }
  if (sesion && vistaActual() !== 'inicio') { location.hash = 'inicio'; return true; }
  return false;
};

function iniciar() {
  sesion = usuarioGuardado();
  if (!sesion) return renderLogin();
  asegurarCodigos();
  renderShell();
  render();
}
function salir() {
  localStorage.removeItem(KEY_SES);
  sesion = null;
  carrito = [];
  cerrarModal();
  history.replaceState(null, '', location.pathname);
  renderLogin();
}

function cambiarMiPin() {
  formModal('Cambiar mi PIN', `
    ${campo('PIN actual', 'actual', '', 'type="password" inputmode="numeric" required')}
    ${campo('PIN nuevo (mínimo 4 dígitos)', 'nuevo', '', 'type="password" inputmode="numeric" required minlength="4"')}
    ${campo('Repetir PIN nuevo', 'repetir', '', 'type="password" inputmode="numeric" required')}`,
  d => {
    if (sesion.pin !== hashPin(d.actual)) { toast('El PIN actual no es correcto'); return false; }
    if (d.nuevo.length < 4) { toast('El PIN debe tener al menos 4 dígitos'); return false; }
    if (d.nuevo !== d.repetir) { toast('Los PIN no coinciden'); return false; }
    sesion.pin = hashPin(d.nuevo);
    sesion.debeCambiarPin = false;
    nube.put('usuarios', sesion);
    guardar();
    toast('PIN actualizado');
    render();
  });
}

// ---------------------------------------------------------------- INICIO
function vInicio() {
  const vs = ventasEn(rango('dia', new Date()), esSup() ? null : sesion.id);
  const total = vs.reduce((s, v) => s + v.total, 0);
  let perfumes = 0, obsequios = 0;
  for (const v of vs) for (const l of v.items) {
    if (l.obsequio) obsequios += l.unidad === 'und' || l.tipo === 'perfume' ? l.cant : 1;
    else if (l.tipo === 'perfume') perfumes += l.cant;
  }
  const bajos = db.insumos.filter(bajo).sort(porNombre);
  const diasSinRespaldo = db.config.ultimoRespaldo ? Math.floor((Date.now() - new Date(db.config.ultimoRespaldo)) / 864e5) : null;
  const hoy = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

  return `
    ${sesion.debeCambiarPin ? '<div class="aviso">🔑 Estás usando el PIN inicial. <a onclick="cambiarMiPin()">Cámbialo aquí</a>.</div>' : ''}
    ${esSup() && !NUBE.activa && (diasSinRespaldo === null || diasSinRespaldo > 7) && db.ventas.length ? `<div class="aviso">💾 ${diasSinRespaldo === null ? 'Aún no has hecho' : `Hace ${diasSinRespaldo} días no haces`} una copia de seguridad. <a href="#ajustes">Hacer respaldo</a>.</div>` : ''}
    <div class="saludo">Hola, ${esc(sesion.nombre.split(' ')[0])} 👋<br><small>${hoy}</small></div>
    <div class="kpis">
      <div class="kpi destacado"><small>${esSup() ? 'Ventas de hoy' : 'Mis ventas de hoy'}</small><b>${money(total)}</b></div>
      <div class="kpi"><small>N.º de ventas</small><b>${vs.length}</b></div>
      <div class="kpi"><small>Perfumes vendidos</small><b>${perfumes}</b></div>
      <div class="kpi"><small>Obsequios</small><b>${obsequios}</b></div>
    </div>
    <div class="accesos">
      <button class="btn primary grande" onclick="ir('vender')">🛒 Nueva venta</button>
      <button class="btn grande" onclick="reporteHoy()">📊 Reporte del día</button>
      <button class="btn grande" onclick="editarCliente()">👤 Nuevo cliente</button>
      ${esSup() ? `<button class="btn grande" onclick="nuevaCompra()">📥 Ingresar inventario</button>` : `<button class="btn grande" onclick="ir('ventas')">🧾 Mis ventas</button>`}
      <button class="btn grande" onclick="editarGasto()">💸 Registrar gasto</button>
      <button class="btn grande" onclick="ir('inventario')">📦 Ver inventario</button>
    </div>
    ${bajos.length ? `<section class="card"><h3>⚠️ Stock bajo (${bajos.length})</h3><ul class="lista">
      ${bajos.slice(0, 8).map(i => `<li class="click" onclick="verInsumo('${i.id}')"><div>${esc(i.nombre)}<br><small class="muted">${TIPOS[i.tipo].label}</small></div><div class="der rojo">${fmtNum(i.stock)} ${i.unidad}<br><small class="muted">mín. ${fmtNum(i.stockMin)}</small></div></li>`).join('')}
      </ul>${bajos.length > 8 ? '<a href="#inventario">Ver todo el inventario</a>' : ''}</section>` : ''}
    <section class="card"><h3>Últimas ventas de hoy</h3><ul class="lista">
      ${vs.slice(-6).reverse().map(filaVenta).join('') || vacio('Aún no hay ventas hoy')}
    </ul></section>`;
}
function reporteHoy() { rep.periodo = 'dia'; rep.fecha = isoDia(new Date()); ir('reportes'); }

// ---------------------------------------------------------------- VENDER
let carrito = [];
let ventaRefId = null;
let ventaDesc = 0;
let ventaCliente = '';
let ventaPago = METODOS[0];

function vVender() {
  const frascos = activos('frasco');
  const hayRefs = db.referencias.some(r => r.activo !== false);
  if (!frascos.length || !hayRefs) {
    return `<div class="card"><h3>Faltan datos para vender perfumes</h3>
      <p class="muted">${!hayRefs ? 'No hay referencias de perfume registradas. ' : ''}${!frascos.length ? 'No hay frascos registrados en el inventario.' : ''}</p>
      ${esSup() ? `<div class="acciones">${!hayRefs ? '<button class="btn primary" onclick="editarReferencia()">+ Crear referencia</button>' : ''}${!frascos.length ? `<button class="btn" onclick="editarInsumo(null,'frasco')">+ Crear frasco</button>` : ''}</div>` : '<p>Pide al supervisor que los registre.</p>'}
    </div>`;
  }
  return `
    ${seccionArmados()}
    <section class="card">
      <h3>${db.armados.some(a => a.activo !== false) ? 'Otro perfume' : 'Perfume'}</h3>
      <div class="buscador">
        <input id="v-buscar" placeholder="🔍 Buscar referencia por nombre o código" autocomplete="off" oninput="buscarRef(this.value)" onfocus="buscarRef(this.value)">
        <div id="v-resultados" class="resultados"></div>
      </div>
      <div id="v-ref-sel" class="ref-sel muted"></div>
      <div class="fila">
        <label>Frasco<select id="v-frasco" onchange="actualizarPrecioPerfume()">${frascos.map(f => `<option value="${f.id}">${esc(f.nombre)} (${fmtNum(f.stock)} disp.)</option>`).join('')}</select></label>
        <label class="w-cant">Cant.<input id="v-cant" type="number" min="1" value="1" inputmode="numeric"></label>
      </div>
      <div class="fila">
        <label>Precio unitario<input id="v-precio" type="number" inputmode="numeric" ${esSup() ? '' : 'readonly'}></label>
        <label class="check"><input type="checkbox" id="v-obs"> 🎁 Es obsequio</label>
      </div>
      <button class="btn primary block" onclick="agregarPerfume()">+ Agregar perfume</button>
    </section>
    <details class="card">
      <summary><h3 style="display:inline">Otro producto u obsequio</h3></summary>
      <p class="muted small">Ej.: frasco vacío, muestra, bolsa de regalo, esencia por ml.</p>
      <label>Producto<select id="p-insumo" onchange="actualizarPrecioProducto()">${opcionesInsumos()}</select></label>
      <div class="fila">
        <label class="w-cant">Cant.<input id="p-cant" type="number" min="0" step="any" value="1" inputmode="decimal"></label>
        <label>Precio unitario<input id="p-precio" type="number" inputmode="numeric" ${esSup() ? '' : 'readonly'}></label>
      </div>
      <label class="check"><input type="checkbox" id="p-obs" checked> 🎁 Es obsequio</label>
      <button class="btn block" onclick="agregarProducto()">+ Agregar</button>
    </details>
    <section class="card"><h3>Venta actual</h3><div id="carrito"></div></section>`;
}
function despuesVender() {
  if (!$('#v-frasco')) return;
  pintarRefSel();
  actualizarPrecioPerfume();
  actualizarPrecioProducto();
  renderCarrito();
}

function buscarRef(q) {
  q = q.trim().toLowerCase();
  const box = $('#v-resultados');
  const rs = db.referencias
    .filter(r => r.activo !== false && `${r.codigo} ${r.nombre} ${r.inspiracion || ''}`.toLowerCase().includes(q))
    .sort(porNombre).slice(0, 8);
  box.innerHTML = rs.map(r => `<button type="button" onclick="elegirRef('${r.id}')"><b>${esc(r.codigo)}</b> ${esc(r.nombre)} <small>${esc(r.genero || '')}${r.inspiracion ? ' · ' + esc(r.inspiracion) : ''}</small></button>`).join('')
    || (q ? '<div class="muted pad">Sin resultados</div>' : '');
}
function elegirRef(id) {
  ventaRefId = id;
  $('#v-resultados').innerHTML = '';
  $('#v-buscar').value = '';
  pintarRefSel();
  actualizarPrecioPerfume();
}
function pintarRefSel() {
  const el = $('#v-ref-sel');
  const r = byId(db.referencias, ventaRefId);
  if (!r) { el.className = 'ref-sel muted'; el.textContent = 'Ninguna referencia seleccionada'; return; }
  const es = byId(db.insumos, r.esenciaId);
  el.className = 'ref-sel';
  el.innerHTML = `🌸 <b>${esc(r.codigo)} · ${esc(r.nombre)}</b><br><small>Esencia disponible: ${fmtNum(es?.stock)} ml</small>`;
}
function actualizarPrecioPerfume() {
  const f = byId(db.insumos, $('#v-frasco')?.value);
  if (!f) return;
  const r = byId(db.referencias, ventaRefId);
  $('#v-precio').value = r ? precioPerfume(r, f) : num(f.precioVenta);
}
function actualizarPrecioProducto() {
  const i = byId(db.insumos, $('#p-insumo')?.value);
  if (i) $('#p-precio').value = num(i.precioVenta);
}

function agregarPerfume() {
  const r = byId(db.referencias, ventaRefId);
  if (!r) return toast('Primero busca y selecciona una referencia');
  const f = byId(db.insumos, $('#v-frasco').value);
  const cant = Math.max(1, Math.round(num($('#v-cant').value)));
  const obsequio = $('#v-obs').checked;
  carrito.push({ tipo: 'perfume', refId: r.id, frascoId: f.id, nombre: `${r.codigo} ${r.nombre}`, detalle: f.nombre, unidad: 'und', cant, precio: obsequio ? 0 : num($('#v-precio').value), obsequio });
  ventaRefId = null;
  $('#v-cant').value = 1;
  $('#v-obs').checked = false;
  pintarRefSel();
  actualizarPrecioPerfume();
  renderCarrito();
  toast(obsequio ? 'Obsequio agregado' : 'Perfume agregado');
}
function agregarProducto() {
  const i = byId(db.insumos, $('#p-insumo').value);
  if (!i) return;
  const cant = num($('#p-cant').value);
  if (cant <= 0) return toast('Cantidad inválida');
  const obsequio = $('#p-obs').checked;
  carrito.push({ tipo: 'producto', insumoId: i.id, nombre: i.nombre, detalle: TIPOS[i.tipo].label, unidad: i.unidad, cant, precio: obsequio ? 0 : num($('#p-precio').value), obsequio });
  renderCarrito();
  toast(obsequio ? 'Obsequio agregado' : 'Producto agregado');
}
function quitarLinea(i) { carrito.splice(i, 1); renderCarrito(); }
// Marca o desmarca una línea de la venta como obsequio (precio 0; igual descuenta inventario)
function alternarObsequio(i) {
  const l = carrito[i];
  if (l.obsequio) { l.obsequio = false; l.precio = num(l.precioLista); }
  else { l.precioLista = l.precio; l.obsequio = true; l.precio = 0; }
  renderCarrito();
}
const cantTexto = l => l.unidad === 'und' ? `${fmtNum(l.cant)} ×` : `${fmtNum(l.cant)} ${l.unidad}`;

function renderCarrito() {
  const el = $('#carrito');
  if (!el) return;
  if (!carrito.length) { el.innerHTML = '<p class="muted">Agrega perfumes u obsequios a la venta.</p>'; return; }
  el.innerHTML = `
    <ul class="lista">${carrito.map((l, i) => `
      <li><div>${cantTexto(l)} <b>${esc(l.nombre)}</b> ${l.obsequio ? '<span class="tag gift">🎁 Obsequio</span>' : ''}<br><small class="muted">${esc(l.detalle)}${l.obsequio ? '' : ' · ' + money(l.precio) + ' c/u'}</small></div>
      <div class="der">${l.obsequio ? '—' : money(l.cant * l.precio)}
        <button class="icon-btn sm" onclick="alternarObsequio(${i})" title="Obsequio" aria-label="Marcar como obsequio" style="${l.obsequio ? '' : 'opacity:.45'}">🎁</button>
        <button class="icon-btn sm" onclick="quitarLinea(${i})" aria-label="Quitar">🗑</button></div></li>`).join('')}
    </ul>
    <div class="fila">
      <label>Descuento ($)<input id="c-desc" type="number" inputmode="numeric" value="${ventaDesc || ''}" oninput="ventaDesc=num(this.value);pintarTotal()"></label>
      <label>Forma de pago<select id="c-pago" onchange="ventaPago=this.value">${METODOS.map(m => `<option ${m === ventaPago ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    </div>
    <label>Cliente<div class="fila-inline">
      <select id="c-cliente" onchange="ventaCliente=this.value"><option value="">Cliente general</option>${clientesOrdenados().map(c => `<option value="${c.id}" ${c.id === ventaCliente ? 'selected' : ''}>${esc(c.nombre)}${c.telefono ? ' · ' + esc(c.telefono) : ''}</option>`).join('')}</select>
      <button type="button" class="btn" onclick="editarCliente(null, id => { ventaCliente = id; renderCarrito(); })">+ Nuevo</button>
    </div></label>
    <label>Nota<input id="c-nota" placeholder="Opcional"></label>
    <div class="total" id="c-total"></div>
    <button class="btn primary block grande" onclick="confirmarVenta()">✔ Confirmar venta</button>
    <button class="btn block ghost" onclick="if(confirm('¿Vaciar la venta actual?')){carrito=[];ventaDesc=0;renderCarrito()}">Vaciar</button>`;
  pintarTotal();
}
function pintarTotal() {
  const sub = carrito.reduce((s, l) => s + l.cant * l.precio, 0);
  $('#c-total').innerHTML = `<span>Total</span><span>${money(Math.max(0, sub - num(ventaDesc)))}</span>`;
}

function confirmarVenta() {
  if (!carrito.length) return;
  const consumo = {};
  const items = carrito.map(l => {
    const m = l.tipo === 'perfume'
      ? consumoPerfume(byId(db.referencias, l.refId), byId(db.insumos, l.frascoId), l.cant, l.mezcla)
      : { [l.insumoId]: l.cant };
    for (const [id, q] of Object.entries(m)) consumo[id] = (consumo[id] || 0) + q;
    return { ...l, consumo: m, costo: costoConsumo(m) };
  });
  const faltan = Object.entries(consumo).map(([id, q]) => ({ i: byId(db.insumos, id), q })).filter(x => x.i && x.i.stock < x.q - 1e-9);
  if (faltan.length && !confirm('Stock insuficiente en inventario:\n' +
      faltan.map(x => `• ${x.i.nombre}: se necesitan ${fmtNum(x.q)} ${x.i.unidad}, hay ${fmtNum(x.i.stock)}`).join('\n') +
      '\n\n¿Registrar la venta de todas formas?')) return;

  const subtotal = items.reduce((s, l) => s + l.cant * l.precio, 0);
  const descuento = Math.min(Math.max(0, num(ventaDesc)), subtotal);
  db.config.consecutivo = Math.max(num(db.config.consecutivo), ...db.ventas.map(x => num(x.numero))) + 1;
  nube.contadorVentas();
  const v = {
    id: uid(), numero: db.config.consecutivo, fecha: new Date().toISOString(), userId: sesion.id,
    clienteId: $('#c-cliente').value || null, items, subtotal, descuento, total: subtotal - descuento,
    costo: items.reduce((s, l) => s + l.costo, 0), metodoPago: $('#c-pago').value, nota: $('#c-nota').value.trim(), anulada: false,
  };
  db.ventas.push(v);
  nube.agregar('ventas', v);
  for (const [id, q] of Object.entries(consumo)) moverStock(id, -q, 'venta', `Venta #${v.numero}`);
  guardar();
  carrito = []; ventaDesc = 0; ventaCliente = ''; ventaPago = METODOS[0];
  rerender();
  verVenta(v.id, true);
}

// ---------------------------------------------------------------- VENTAS (historial)
let filtroVentasDia = isoDia(new Date());

function filaVenta(v) {
  return `<li class="click ${v.anulada ? 'anulada' : ''}" onclick="verVenta('${v.id}')">
    <div><b>#${v.numero}</b> · ${hora(v.fecha)} · ${esc(v.metodoPago)}<br><small class="muted">${esc(nombreCliente(v.clienteId))}${esSup() ? ' · ' + esc(nombreUsuario(v.userId)) : ''}</small></div>
    <div class="der">${money(v.total)}${v.anulada ? '<br><span class="tag">Anulada</span>' : ''}</div></li>`;
}
function vVentas() {
  const ini = parseDia(filtroVentasDia);
  const fin = new Date(ini); fin.setDate(fin.getDate() + 1);
  const vs = ventasEn({ ini, fin }, esSup() ? null : sesion.id, true).reverse();
  const total = vs.filter(v => !v.anulada).reduce((s, v) => s + v.total, 0);
  return `
    <div class="card fila">
      <label>Día<input type="date" value="${filtroVentasDia}" onchange="filtroVentasDia=this.value||isoDia(new Date());render()"></label>
      <div class="kpi"><small>Total ${esSup() ? '' : '(mis ventas)'}</small><b>${money(total)}</b></div>
    </div>
    <ul class="lista card">${vs.map(filaVenta).join('') || vacio('No hay ventas en este día')}</ul>`;
}

function htmlRecibo(v) {
  const c = byId(db.clientes, v.clienteId);
  return `
    <div class="rec-head"><img class="no-print" src="logo-192.png" alt=""><b>${esc(db.config.negocio)}</b>${db.config.nit ? `<br><small>NIT ${esc(db.config.nit)}</small>` : ''}${db.config.telefono ? `<br><small>Tel. ${esc(db.config.telefono)}</small>` : ''}</div>
    <div class="rec-meta">Venta <b>#${v.numero}</b> · ${fechaHora(v.fecha)}<br>Atendió: ${esc(nombreUsuario(v.userId))}<br>Cliente: ${esc(c?.nombre || 'Cliente general')}${c?.telefono ? ' · ' + esc(c.telefono) : ''}</div>
    ${v.anulada ? `<div class="aviso error">ANULADA el ${fechaHora(v.anulacion?.fecha)}: ${esc(v.anulacion?.motivo || '')}</div>` : ''}
    <table class="tabla">
      ${v.items.map(l => `<tr><td>${cantTexto(l)} ${esc(l.nombre)}<br><small class="muted">${esc(l.detalle)}${l.obsequio ? ' · 🎁 Obsequio' : ''}</small></td><td class="der">${l.obsequio ? 'Obsequio' : money(l.cant * l.precio)}</td></tr>`).join('')}
      ${v.descuento ? `<tr><td>Subtotal</td><td class="der">${money(v.subtotal)}</td></tr><tr><td>Descuento</td><td class="der">−${money(v.descuento)}</td></tr>` : ''}
      <tr class="tot"><td>TOTAL</td><td class="der">${money(v.total)}</td></tr>
    </table>
    <div class="rec-meta">Forma de pago: ${esc(v.metodoPago)}${v.nota ? `<br>Nota: ${esc(v.nota)}` : ''}</div>
    ${esSup() ? `<div class="muted small no-print">Costo de insumos: ${money(v.costo)} · Utilidad: ${money(v.total - v.costo)}</div>` : ''}
    <div class="rec-pie">${esc(db.config.mensajeRecibo || '')}</div>`;
}
function textoRecibo(v) {
  const L = [`*${db.config.negocio}*`, `Venta #${v.numero} - ${fechaHora(v.fecha)}`, `Cliente: ${nombreCliente(v.clienteId)}`, ''];
  for (const l of v.items) L.push(`${cantTexto(l)} ${l.nombre} (${l.detalle})${l.obsequio ? ' - OBSEQUIO' : ': ' + money(l.cant * l.precio)}`);
  if (v.descuento) L.push(`Descuento: -${money(v.descuento)}`);
  L.push('', `*TOTAL: ${money(v.total)}*`, `Pago: ${v.metodoPago}`);
  if (db.config.mensajeRecibo) L.push('', db.config.mensajeRecibo);
  return L.join('\n');
}
function verVenta(id, nueva = false) {
  const v = buscarVenta(id);
  modal(nueva ? '✅ Venta registrada' : `Venta #${v.numero}`, `
    <div class="recibo">${htmlRecibo(v)}</div>
    <div class="acciones">
      <button class="btn" onclick="compartirTexto(textoRecibo(buscarVenta('${v.id}')))">📤 Compartir</button>
      <button class="btn" onclick="imprimir('Venta ${v.numero}')">🖨 Imprimir</button>
      ${esSup() && !v.anulada ? `<button class="btn danger" onclick="anularVenta('${v.id}')">Anular</button>` : ''}
    </div>
    ${nueva ? `<button class="btn primary block" onclick="cerrarModal()">Nueva venta</button>` : ''}`);
}
function anularVenta(id) {
  const v = buscarVenta(id);
  const motivo = prompt(`Anular venta #${v.numero}. Se devolverán los insumos al inventario.\n\nMotivo:`);
  if (motivo === null) return;
  v.anulada = true;
  v.anulacion = { fecha: new Date().toISOString(), userId: sesion.id, motivo: motivo.trim() };
  nube.put('ventas', v);
  for (const l of v.items) for (const [iid, q] of Object.entries(l.consumo || {})) moverStock(iid, q, 'anulación', `Venta #${v.numero}`);
  guardar();
  cerrarModal();
  rerender();
  toast('Venta anulada y stock devuelto');
}

// ---------------------------------------------------------------- INVENTARIO
let invTab = 'esencia';
let invBuscar = '';

function vInventario() {
  const valor = db.insumos.filter(i => i.activo !== false).reduce((s, i) => s + Math.max(0, num(i.stock)) * num(i.costo), 0);
  const nBajos = db.insumos.filter(bajo).length;
  return `
    ${esSup() ? `<div class="kpis"><div class="kpi"><small>Valor del inventario</small><b>${money(valor)}</b></div><div class="kpi"><small>Insumos con stock bajo</small><b class="${nBajos ? 'rojo' : ''}">${nBajos}</b></div></div>` : ''}
    ${esSup() ? `<button class="btn primary block grande" onclick="nuevaCompra()">📥 Ingresar inventario</button>
      <div class="acciones" style="margin:.5rem 0 .75rem">
        <button class="btn" onclick="$('#archivo-excel').click()">📄 Importar desde Excel</button>
        <button class="btn" onclick="descargarFormato()">⬇ Descargar formato</button>
      </div>
      <input type="file" id="archivo-excel" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style="display:none" onchange="importarExcel(this.files[0]);this.value=''">` : ''}
    <div class="tabs">${Object.entries(TIPOS).map(([k, t]) => `<button class="${k === invTab ? 'activo' : ''}" onclick="invTab='${k}';render()">${t.label}</button>`).join('')}</div>
    <div class="card fila">
      <input placeholder="🔍 Buscar..." value="${esc(invBuscar)}" oninput="invBuscar=this.value;$('#inv-lista').innerHTML=listaInventario()">
      ${esSup() ? `<button class="btn primary" style="flex:0 0 auto" onclick="editarInsumo(null,'${invTab}')">+ Nuevo</button>` : ''}
    </div>
    <ul class="lista card" id="inv-lista">${listaInventario()}</ul>`;
}
function listaInventario() {
  const q = invBuscar.trim().toLowerCase();
  const its = db.insumos.filter(i => i.tipo === invTab && `${i.codigo || ''} ${i.nombre}`.toLowerCase().includes(q))
    .sort((a, b) => (a.activo === false) - (b.activo === false) || porNombre(a, b));
  return its.map(i => `
    <li class="click" onclick="verInsumo('${i.id}')" style="${i.activo === false ? 'opacity:.5' : ''}">
      <div><span class="codigo">${esc(i.codigo || '')}</span> <b>${esc(i.nombre)}</b> ${bajo(i) ? '<span class="tag bajo">Bajo</span>' : ''}${i.activo === false ? ' <span class="tag">Inactivo</span>' : ''}
        <br><small class="muted">${i.tipo === 'frasco' ? `Perfume: ${money(i.precioVenta)}` : ''}${esSup() ? `${i.tipo === 'frasco' ? ' · ' : ''}Costo: ${moneyU(i.costo)}/${i.unidad}` : ''}</small></div>
      <div class="der ${i.stock <= 0 ? 'rojo' : ''}"><b>${fmtNum(i.stock)}</b> ${i.unidad}</div>
    </li>`).join('') || vacio('No hay registros en esta categoría');
}

function verInsumo(id) {
  const i = byId(db.insumos, id);
  const refs = i.tipo === 'esencia' ? db.referencias.filter(r => r.esenciaId === id) : [];
  const prov = byId(db.proveedores, i.proveedorId);
  modal(i.nombre, `
    <div class="kv">
      <span>Código</span><b class="codigo">${esc(i.codigo || '—')}</b>
      <span>Categoría</span><b>${TIPOS[i.tipo].label}</b>
      <span>Stock actual</span><b class="${bajo(i) ? 'rojo' : ''}">${fmtNum(i.stock)} ${i.unidad}</b>
      <span>Stock mínimo</span><b>${fmtNum(i.stockMin)} ${i.unidad}</b>
      ${i.tipo === 'frasco' ? `<span>Capacidad</span><b>${fmtNum(i.capacidad)} ml</b><span>Precio del perfume</span><b>${money(i.precioVenta)}</b>` : ''}
      ${i.tipo === 'otro' && num(i.precioVenta) ? `<span>Precio de venta</span><b>${money(i.precioVenta)}</b>` : ''}
      ${esSup() ? `<span>Costo unitario</span><b>${moneyU(i.costo)} / ${i.unidad}</b><span>Valor en stock</span><b>${money(Math.max(0, i.stock) * num(i.costo))}</b>` : ''}
      ${esSup() && prov ? `<span>Proveedor</span><b>${esc(prov.nombre)}</b>` : ''}
    </div>
    ${refs.length ? `<p class="small muted">Usada en: ${refs.map(r => esc(r.nombre)).join(', ')}</p>` : ''}
    ${esSup() ? `
      <div class="acciones"><button class="btn" onclick="editarInsumo('${id}')">✏️ Editar</button><button class="btn primary" onclick="ajustarStock('${id}')">± Ajustar stock</button></div>
      <h4>Movimientos recientes</h4>
      <ul class="lista mini" id="movs">${vacio('Cargando…')}</ul>` : ''}`);
  if (!esSup()) return;
  movimientosDe(id).then(movs => {
    const ul = $('#movs');
    if (ul) ul.innerHTML = movs.map(m => `<li><div>${esc(m.tipo)} <small class="muted">${esc(m.ref || '')}${m.nota ? ' · ' + esc(m.nota) : ''}</small><br><small class="muted">${fechaHora(m.fecha)} · ${esc(nombreUsuario(m.userId))}</small></div>
      <div class="der"><span class="${m.cantidad < 0 ? 'rojo' : 'verde'}">${m.cantidad > 0 ? '+' : ''}${fmtNum(m.cantidad)}</span><br><small class="muted">Saldo ${fmtNum(m.saldo)}</small></div></li>`).join('') || vacio('Sin movimientos');
  }).catch(() => { const ul = $('#movs'); if (ul) ul.innerHTML = vacio('Sin conexión para ver el historial'); });
}

function editarInsumo(id, tipoDef = 'esencia') {
  const i = id ? byId(db.insumos, id) : { tipo: tipoDef, unidad: TIPOS[tipoDef].unidad, stockMin: 0, costo: 0, activo: true };
  const f = formModal(id ? 'Editar insumo' : 'Nuevo insumo', `
    <div class="fila">
      ${campo('Código', 'codigo', i.codigo || '', `placeholder="Automático (${codigoInsumo(i.tipo)})" autocapitalize="characters"`)}
      ${campo('Nombre *', 'nombre', i.nombre, 'required placeholder="Ej: Esencia One Million"')}
    </div>
    <div class="fila">
      ${selector('Categoría', 'tipo', Object.entries(TIPOS).map(([k, t]) => ({ v: k, t: t.label })), i.tipo, 'onchange="tipoInsumoCambio(this.form, true)"')}
      ${selector('Unidad', 'unidad', [{ v: 'ml', t: 'Mililitros (ml)' }, { v: 'g', t: 'Gramos (g)' }, { v: 'und', t: 'Unidades' }], i.unidad)}
    </div>
    <div class="solo-frasco">${campo('Capacidad del frasco (ml) *', 'capacidad', i.capacidad || '', 'type="number" step="any" inputmode="decimal"')}</div>
    <div class="solo-venta">${campo('Precio de venta ($)', 'precioVenta', i.precioVenta || '', 'type="number" step="any" inputmode="numeric"')}
      <p class="small muted solo-frasco" style="margin-top:-.4rem">Precio del perfume armado en este frasco (cada referencia puede tener precio especial).</p></div>
    <div class="fila">
      ${campo('Stock mínimo (alerta)', 'stockMin', i.stockMin, 'type="number" step="any" inputmode="decimal"')}
      ${campo('Costo por unidad ($)', 'costo', i.costo, 'type="number" step="any" inputmode="decimal"')}
    </div>
    ${!id ? campo('Stock inicial', 'stock', '', 'type="number" step="any" inputmode="decimal" placeholder="0"') : ''}
    ${selector('Proveedor habitual', 'proveedorId', [{ v: '', t: '— Ninguno —' }, ...[...db.proveedores].sort(porNombre).map(p => ({ v: p.id, t: p.nombre }))], i.proveedorId)}
    ${id ? casilla('Activo (desmarcar para ocultarlo sin borrar el historial)', 'activo', i.activo !== false) : ''}`,
  d => {
    const datos = {
      nombre: d.nombre.trim(), tipo: d.tipo, unidad: d.unidad, stockMin: num(d.stockMin), costo: num(d.costo),
      capacidad: num(d.capacidad), precioVenta: num(d.precioVenta), proveedorId: d.proveedorId || null,
    };
    if (datos.tipo === 'frasco' && datos.capacidad <= 0) { toast('Indica la capacidad del frasco en ml'); return false; }
    datos.codigo = d.codigo.trim().toUpperCase() || (id && i.tipo === datos.tipo && i.codigo) || codigoInsumo(datos.tipo);
    if (db.insumos.some(x => x.id !== id && String(x.codigo).toUpperCase() === datos.codigo)) { toast('Ya existe un producto con ese código'); return false; }
    if (id) { Object.assign(i, datos, { activo: !!d.activo }); nube.put('insumos', i); }
    else {
      const n = { id: uid(), ...datos, stock: 0, activo: true };
      db.insumos.push(n);
      nube.agregar('insumos', n);
      if (num(d.stock)) moverStock(n.id, num(d.stock), 'inicial', 'Stock inicial');
      invTab = n.tipo;
    }
    guardar();
    rerender();
    toast('Guardado');
  });
  tipoInsumoCambio(f, false);
}
function tipoInsumoCambio(f, cambiarUnidad) {
  const t = f.tipo.value;
  f.querySelectorAll('.solo-frasco').forEach(e => e.style.display = t === 'frasco' ? 'block' : 'none');
  f.querySelectorAll('.solo-venta').forEach(e => e.style.display = t === 'frasco' || t === 'otro' ? 'block' : 'none');
  if (cambiarUnidad) f.unidad.value = TIPOS[t].unidad;
}

function ajustarStock(id) {
  const i = byId(db.insumos, id);
  formModal(`Ajustar: ${i.nombre}`, `
    <p>Stock actual: <b>${fmtNum(i.stock)} ${i.unidad}</b></p>
    ${selector('Tipo de ajuste', 'modo', [{ v: 'conteo', t: 'Conteo físico (nuevo total)' }, { v: 'entrada', t: 'Entrada (+)' }, { v: 'salida', t: 'Salida / merma / daño (−)' }], 'conteo')}
    ${campo(`Cantidad (${i.unidad}) *`, 'cantidad', '', 'type="number" step="any" inputmode="decimal" required')}
    ${campo('Motivo', 'motivo', '', 'placeholder="Ej: conteo mensual, frasco roto"')}
    <p class="small muted">Para compras a proveedores usa <b>Ingresar inventario</b>, así se actualiza el costo.</p>`,
  d => {
    const q = num(d.cantidad);
    const delta = d.modo === 'conteo' ? q - num(byId(db.insumos, id).stock) :d.modo === 'entrada' ? q : -q;
    if (!delta) { toast('Sin cambios'); return; }
    moverStock(id, delta, 'ajuste', d.modo === 'conteo' ? 'Conteo físico' : d.modo === 'entrada' ? 'Entrada manual' : 'Salida/merma', d.motivo.trim());
    guardar();
    rerender();
    toast('Stock actualizado');
  });
}

// ---------------------------------------------------------------- REFERENCIAS
let refBuscar = '';

function vReferencias() {
  return `
    <div class="card fila">
      <input placeholder="🔍 Buscar por nombre, código o inspiración" value="${esc(refBuscar)}" oninput="refBuscar=this.value;$('#ref-lista').innerHTML=listaReferencias()">
      ${esSup() ? '<button class="btn primary" style="flex:0 0 auto" onclick="editarReferencia()">+ Nueva</button>' : ''}
    </div>
    <p class="small muted">Mezcla general: ${db.config.pctEsencia}% esencia · ${db.config.pctFijador}% fijador · ${100 - db.config.pctEsencia - db.config.pctFijador}% alcohol</p>
    <ul class="lista card" id="ref-lista">${listaReferencias()}</ul>`;
}
function listaReferencias() {
  const q = refBuscar.trim().toLowerCase();
  const rs = db.referencias.filter(r => `${r.codigo} ${r.nombre} ${r.inspiracion || ''} ${r.genero || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (a.activo === false) - (b.activo === false) || porNombre(a, b));
  return rs.map(r => {
    const es = byId(db.insumos, r.esenciaId);
    return `<li class="click" onclick="verReferencia('${r.id}')" style="${r.activo === false ? 'opacity:.5' : ''}">
      <div><b>${esc(r.codigo)}</b> · ${esc(r.nombre)}<br><small class="muted">${esc(r.genero || '')}${r.inspiracion ? ' · ' + esc(r.inspiracion) : ''}</small></div>
      <div class="der ${es && bajo(es) ? 'rojo' : ''}">${fmtNum(es?.stock)} ml<br><small class="muted">esencia</small></div></li>`;
  }).join('') || vacio(db.referencias.length ? 'Sin resultados' : 'Aún no hay referencias registradas');
}

function verReferencia(id) {
  const r = byId(db.referencias, id);
  const es = byId(db.insumos, r.esenciaId);
  const { pE, pF } = pctsRef(r);
  modal(`${r.codigo} · ${r.nombre}`, `
    <div class="kv">
      <span>Género</span><b>${esc(r.genero || '—')}</b>
      ${r.inspiracion ? `<span>Inspiración</span><b>${esc(r.inspiracion)}</b>` : ''}
      <span>Esencia</span><b>${esc(es?.nombre || 'Sin asignar')}</b>
      <span>Esencia disponible</span><b>${fmtNum(es?.stock)} ml</b>
      <span>Mezcla</span><b>${pE}% esencia · ${pF}% fijador · ${100 - pE - pF}% alcohol</b>
    </div>
    ${r.notas ? `<p class="small">${esc(r.notas)}</p>` : ''}
    <table class="tabla"><tr><th>Frasco</th><th class="der">Precio</th><th class="der">Alcanza para</th></tr>
      ${activos('frasco').map(f => `<tr><td>${esc(f.nombre)}</td><td class="der">${money(precioPerfume(r, f))}</td><td class="der">${alcance(r, f)} und</td></tr>`).join('')}
    </table>
    <div class="acciones">
      <button class="btn primary" onclick="cerrarModal();ventaRefId='${r.id}';ir('vender')">🛒 Vender</button>
      ${esSup() ? `<button class="btn" onclick="editarReferencia('${r.id}')">✏️ Editar</button>` : ''}
    </div>`);
}

function siguienteCodigo() {
  const n = db.referencias.reduce((m, r) => Math.max(m, parseInt(String(r.codigo).replace(/\D/g, '')) || 0), 0) + 1;
  return 'R' + String(n).padStart(3, '0');
}
function editarReferencia(id) {
  const r = id ? byId(db.referencias, id) : { codigo: siguienteCodigo(), genero: 'Unisex', esenciaId: '__nueva', precios: {}, activo: true, pctEsencia: null, pctFijador: null };
  const esencias = db.insumos.filter(i => i.tipo === 'esencia' && (i.activo !== false || i.id === r.esenciaId)).sort(porNombre);
  const f = formModal(id ? 'Editar referencia' : 'Nueva referencia', `
    <div class="fila">${campo('Código *', 'codigo', r.codigo, 'required')}${selector('Género', 'genero', GENEROS.map(g => ({ v: g, t: g })), r.genero)}</div>
    ${campo('Nombre *', 'nombre', r.nombre, 'required placeholder="Ej: Invictus"')}
    ${campo('Inspiración / casa', 'inspiracion', r.inspiracion, 'placeholder="Ej: Paco Rabanne"')}
    ${selector('Esencia que usa', 'esenciaId', [{ v: '__nueva', t: '➕ Crear esencia nueva para esta referencia' }, ...esencias.map(e => ({ v: e.id, t: `${e.nombre} (${fmtNum(e.stock)} ml)` }))], r.esenciaId, 'onchange="this.form.querySelector(\'.solo-nueva\').style.display=this.value===\'__nueva\'?\'block\':\'none\'"')}
    <div class="solo-nueva"><div class="fila">
      ${campo('Esencia inicial (ml)', 'esStock', '', 'type="number" step="any" inputmode="decimal" placeholder="0"')}
      ${campo('Costo por ml ($)', 'esCosto', '', 'type="number" step="any" inputmode="decimal" placeholder="0"')}
    </div></div>
    <div class="fila">
      ${campo(`% esencia (vacío = ${db.config.pctEsencia}%)`, 'pctEsencia', r.pctEsencia ?? '', 'type="number" step="any" inputmode="decimal"')}
      ${campo(`% fijador (vacío = ${db.config.pctFijador}%)`, 'pctFijador', r.pctFijador ?? '', 'type="number" step="any" inputmode="decimal"')}
    </div>
    <h4>Precio especial por frasco <small class="muted">(vacío = precio normal)</small></h4>
    <div class="fila">${activos('frasco').map(fr => campo(esc(fr.nombre), 'precio_' + fr.id, r.precios?.[fr.id] || '', `type="number" inputmode="numeric" placeholder="${num(fr.precioVenta)}"`)).join('')}</div>
    ${area('Notas (familia olfativa, descripción…)', 'notas', r.notas)}
    ${id ? casilla('Activa (desmarcar para ocultarla de ventas)', 'activo', r.activo !== false) : ''}`,
  d => {
    const codigo = d.codigo.trim().toUpperCase();
    if (db.referencias.some(x => x.id !== id && String(x.codigo).toUpperCase() === codigo)) { toast('Ya existe una referencia con ese código'); return false; }
    const pE = d.pctEsencia === '' ? null : num(d.pctEsencia), pF = d.pctFijador === '' ? null : num(d.pctFijador);
    if ((pE ?? db.config.pctEsencia) + (pF ?? db.config.pctFijador) > 100) { toast('Esencia + fijador no puede superar 100%'); return false; }
    let esenciaId = d.esenciaId;
    if (esenciaId === '__nueva') {
      const es = { id: uid(), codigo: codigoInsumo('esencia'), tipo: 'esencia', nombre: `Esencia ${d.nombre.trim()}`, unidad: 'ml', stock: 0, stockMin: 50, costo: num(d.esCosto), activo: true };
      db.insumos.push(es);
      nube.agregar('insumos', es);
      if (num(d.esStock)) moverStock(es.id, num(d.esStock), 'inicial', 'Stock inicial');
      esenciaId = es.id;
    }
    const precios = {};
    for (const fr of activos('frasco')) if (num(d['precio_' + fr.id]) > 0) precios[fr.id] = num(d['precio_' + fr.id]);
    const datos = { codigo, nombre: d.nombre.trim(), genero: d.genero, inspiracion: d.inspiracion.trim(), esenciaId, pctEsencia: pE, pctFijador: pF, precios, notas: d.notas.trim() };
    if (id) { Object.assign(r, datos, { activo: !!d.activo }); nube.put('referencias', r); }
    else {
      const n = { id: uid(), ...datos, activo: true, creada: new Date().toISOString() };
      db.referencias.push(n);
      nube.agregar('referencias', n);
    }
    guardar();
    rerender();
    toast('Referencia guardada');
  });
  f.querySelector('.solo-nueva').style.display = f.esenciaId.value === '__nueva' ? 'block' : 'none';
}

// ---------------------------------------------------------------- PERFUMES ARMADOS (recetas de los más vendidos)
// Un perfume armado fija referencia, frasco, mezcla exacta y precio. Ej.: One Million 30 ml =
// 50 % esencia + 50 % alcohol + frasco 30 ml Singler. En Vender se agregan con un toque.
const mezclaArmado = a => ({ pE: num(a.pctEsencia), pA: num(a.pctAlcohol), pF: num(a.pctFijador) });
const mezclaTexto = a => [
  num(a.pctEsencia) && `${fmtNum(a.pctEsencia)}% esencia`,
  num(a.pctAlcohol) && `${fmtNum(a.pctAlcohol)}% alcohol`,
  num(a.pctFijador) && `${fmtNum(a.pctFijador)}% fijador`,
].filter(Boolean).join(' · ');

// Cuántos se pueden armar con el stock actual
function disponiblesArmado(a) {
  const ref = byId(db.referencias, a.refId), fr = byId(db.insumos, a.frascoId);
  if (!ref || !fr) return 0;
  const m = consumoPerfume(ref, fr, 1, mezclaArmado(a));
  const ids = Object.keys(m);
  return ids.length ? Math.max(0, Math.floor(Math.min(...ids.map(id => num(byId(db.insumos, id)?.stock) / m[id])))) : 0;
}
// Unidades vendidas por perfume armado en los últimos 60 días (para ordenar "más vendidos")
function vendidosArmado() {
  const desde = new Date(Date.now() - 60 * 864e5);
  const c = {};
  for (const v of db.ventas) {
    if (v.anulada || new Date(v.fecha) < desde) continue;
    for (const l of v.items) if (l.armadoId) c[l.armadoId] = (c[l.armadoId] || 0) + l.cant;
  }
  return c;
}
function armadosOrdenados(incluirInactivos = false) {
  const c = vendidosArmado();
  return db.armados.filter(a => incluirInactivos || a.activo !== false)
    .sort((a, b) => (a.activo === false) - (b.activo === false) || (c[b.id] || 0) - (c[a.id] || 0) || porNombre(a, b));
}

function seccionArmados() {
  const as = armadosOrdenados();
  if (!as.length) return esSup() ? '<div class="aviso">⭐ Crea tus <a href="#armados">perfumes armados</a> más vendidos para venderlos con un solo toque.</div>' : '';
  return `<section class="card"><h3>⭐ Más vendidos</h3>
    ${as.length > 6 ? '<input placeholder="🔍 Buscar perfume" oninput="filtrarArmados(this.value)" style="margin:0 0 .6rem">' : ''}
    <div class="armados" id="lista-armados">${botonesArmados(as)}</div>
    <p class="small muted" style="margin:.5rem 0 0">Toca para agregar 1 a la venta. En la venta, 🎁 lo marca como obsequio.</p></section>`;
}
function botonesArmados(as) {
  return as.map(a => {
    const d = disponiblesArmado(a);
    return `<button class="armado ${d < 1 ? 'sin-stock' : ''}" onclick="agregarArmado('${a.id}')">
      <b>${esc(a.nombre)}</b><small>${esc(byId(db.insumos, a.frascoId)?.nombre || '')}</small>
      <small>${d < 1 ? 'Sin stock' : `Alcanza para ${d}`}</small><div class="precio">${money(a.precio)}</div></button>`;
  }).join('') || '<p class="muted">Sin resultados</p>';
}
function filtrarArmados(q) {
  q = q.trim().toLowerCase();
  $('#lista-armados').innerHTML = botonesArmados(armadosOrdenados().filter(a => `${a.codigo} ${a.nombre}`.toLowerCase().includes(q)));
}
function agregarArmado(id) {
  const a = byId(db.armados, id);
  const fr = byId(db.insumos, a.frascoId), ref = byId(db.referencias, a.refId);
  if (!fr || !ref) return toast('A este perfume le falta la esencia o el frasco: revísalo en Perfumes armados');
  const existente = carrito.find(l => l.armadoId === id && !l.obsequio);
  if (existente) existente.cant++;
  else carrito.push({
    tipo: 'perfume', armadoId: id, refId: ref.id, frascoId: fr.id, nombre: a.nombre, detalle: `${fr.nombre} · ${mezclaTexto(a)}`,
    unidad: 'und', cant: 1, precio: num(a.precio), obsequio: false, mezcla: mezclaArmado(a),
  });
  renderCarrito();
  toast(`${a.nombre} agregado`);
}

function vArmados() {
  const c = vendidosArmado();
  return `
    ${esSup() ? '<button class="btn primary block grande" onclick="editarArmado()" style="margin-bottom:.75rem">+ Nuevo perfume armado</button>' : ''}
    <p class="small muted">Recetas fijas de los perfumes que más vendes (esencia, frasco, mezcla y precio). Aparecen de primeras en <b>Vender</b>, ordenados por lo más vendido en los últimos 60 días.</p>
    <ul class="lista card">${armadosOrdenados(esSup()).map(a => `
      <li class="click" onclick="${esSup() ? `editarArmado('${a.id}')` : `agregarArmado('${a.id}');ir('vender')`}" style="${a.activo === false ? 'opacity:.5' : ''}">
        <div><span class="codigo">${esc(a.codigo)}</span> <b>${esc(a.nombre)}</b>${a.activo === false ? ' <span class="tag">Inactivo</span>' : ''}
          <br><small class="muted">${esc(byId(db.insumos, a.frascoId)?.nombre || 'Sin frasco')} · ${mezclaTexto(a)}</small></div>
        <div class="der"><b>${money(a.precio)}</b><br><small class="muted">${c[a.id] || 0} vendidos · alcanza ${disponiblesArmado(a)}</small></div>
      </li>`).join('') || vacio('Aún no hay perfumes armados')}</ul>`;
}

function editarArmado(id) {
  const refs = db.referencias.filter(r => r.activo !== false).sort(porNombre);
  const frascos = activos('frasco');
  if (!refs.length) return toast('Primero crea la referencia (esencia) en Referencias');
  if (!frascos.length) return toast('Primero crea el frasco en Inventario');
  const a = id ? byId(db.armados, id) : { refId: refs[0].id, frascoId: frascos[0].id, pctEsencia: 50, pctAlcohol: 50, pctFijador: 0, activo: true };
  const f = formModal(id ? 'Editar perfume armado' : 'Nuevo perfume armado', `
    <div class="fila">
      ${campo('Código', 'codigo', a.codigo || '', `placeholder="Automático (${codigoArmado()})"`)}
      ${campo('Nombre', 'nombre', a.nombre || '', 'placeholder="Ej: One Million 30 ml"')}
    </div>
    ${selector('Esencia / referencia *', 'refId', refs.map(r => ({ v: r.id, t: `${r.codigo} · ${r.nombre}` })), a.refId)}
    ${selector('Frasco *', 'frascoId', frascos.map(fr => ({ v: fr.id, t: `${fr.codigo || ''} ${fr.nombre} (${fmtNum(fr.capacidad)} ml)` })), a.frascoId)}
    <h4>Mezcla (debe sumar 100 %)</h4>
    <div class="fila">
      ${campo('% esencia', 'pctEsencia', a.pctEsencia, 'type="number" step="any" inputmode="decimal" oninput="sumaMezcla(this.form)"')}
      ${campo('% alcohol', 'pctAlcohol', a.pctAlcohol, 'type="number" step="any" inputmode="decimal" oninput="sumaMezcla(this.form)"')}
      ${campo('% fijador', 'pctFijador', a.pctFijador, 'type="number" step="any" inputmode="decimal" oninput="sumaMezcla(this.form)"')}
    </div>
    <p class="small" id="suma-mezcla"></p>
    ${campo('Precio de venta ($)', 'precio', a.precio || '', 'type="number" inputmode="numeric" placeholder="Vacío = precio del frasco"')}
    ${id ? casilla('Activo (desmarcar para ocultarlo de Vender)', 'activo', a.activo !== false) : ''}`,
  d => {
    const ref = byId(db.referencias, d.refId), fr = byId(db.insumos, d.frascoId);
    const pE = num(d.pctEsencia), pA = num(d.pctAlcohol), pF = num(d.pctFijador);
    if (Math.abs(pE + pA + pF - 100) > 0.01) { toast(`La mezcla debe sumar 100 % (va ${fmtNum(pE + pA + pF)} %)`); return false; }
    const codigo = d.codigo.trim().toUpperCase() || a.codigo || codigoArmado();
    if (db.armados.some(x => x.id !== id && String(x.codigo).toUpperCase() === codigo)) { toast('Ya existe un perfume armado con ese código'); return false; }
    const datos = {
      codigo, nombre: d.nombre.trim() || `${ref.nombre} ${fmtNum(fr.capacidad)} ml`, refId: ref.id, frascoId: fr.id,
      pctEsencia: pE, pctAlcohol: pA, pctFijador: pF, precio: num(d.precio) || precioPerfume(ref, fr),
    };
    if (id) { Object.assign(a, datos, { activo: !!d.activo }); nube.put('armados', a); }
    else {
      const n = { id: uid(), ...datos, activo: true, creado: new Date().toISOString() };
      db.armados.push(n);
      nube.agregar('armados', n);
    }
    guardar();
    rerender();
    toast('Perfume armado guardado');
  });
  sumaMezcla(f);
}
function sumaMezcla(f) {
  const s = num(f.pctEsencia.value) + num(f.pctAlcohol.value) + num(f.pctFijador.value);
  const el = $('#suma-mezcla');
  el.textContent = `Suma: ${fmtNum(s)} %${Math.abs(s - 100) > 0.01 ? ' — debe ser 100 %' : ' ✓'}`;
  el.className = 'small ' + (Math.abs(s - 100) > 0.01 ? 'rojo' : 'verde');
}

// ---------------------------------------------------------------- INGRESO DE INVENTARIO (compras y entradas)
function vCompras() {
  const cs = [...db.compras].sort((a, b) => b.fecha.localeCompare(a.fecha));
  return `
    <button class="btn primary block grande" onclick="nuevaCompra()" style="margin-bottom:.75rem">📥 Ingresar inventario</button>
    <p class="small muted">Usa esta opción cada vez que llegue mercancía (esencias, alcohol, fijador, frascos, empaques) o para cargar el inventario inicial.</p>
    <ul class="lista card">${cs.map(c => `<li class="click" onclick="verCompra('${c.id}')">
      <div><b>${esc(byId(db.proveedores, c.proveedorId)?.nombre || c.tipo || 'Sin proveedor')}</b>${c.factura ? ` · Fact. ${esc(c.factura)}` : ''}<br><small class="muted">${fechaCorta(c.fecha)} · ${esc(c.tipo || 'Compra a proveedor')} · ${c.items.length} ítem(s)</small></div>
      <div class="der">${money(c.total)}</div></li>`).join('') || vacio('Aún no hay ingresos de inventario')}</ul>`;
}
function filaCompra() {
  return `<div class="card fila-compra" style="background:var(--fondo);padding:.6rem">
    <label>Producto<select name="insumo" onchange="totalCompra()">${opcionesInsumos()}</select></label>
    <div class="fila">
      <label>Cantidad<input name="cant" type="number" step="any" inputmode="decimal" oninput="totalCompra()"></label>
      <label>Valor total pagado ($)<input name="valor" type="number" step="any" inputmode="numeric" oninput="totalCompra()"></label>
      <button type="button" class="icon-btn sm" style="flex:0 0 auto" onclick="this.closest('.fila-compra').remove();totalCompra()" aria-label="Quitar línea">🗑</button>
    </div>
    <small class="muted costo-u"></small></div>`;
}
// Total del ingreso y costo unitario de cada línea (ej: $500 por ml)
function totalCompra() {
  let t = 0;
  document.querySelectorAll('.fila-compra').forEach(e => {
    const i = byId(db.insumos, e.querySelector('[name=insumo]').value);
    const cant = num(e.querySelector('[name=cant]').value), valor = num(e.querySelector('[name=valor]').value);
    t += valor;
    e.querySelector('.costo-u').textContent = i && cant > 0
      ? `Stock actual: ${fmtNum(i.stock)} ${i.unidad}${valor > 0 ? ` · Costo: ${moneyU(valor / cant)} por ${i.unidad}` : ''}`
      : '';
  });
  $('#compra-total').innerHTML = `<span>Total</span><span>${money(t)}</span>`;
}
function nuevaCompra() {
  if (!db.insumos.some(i => i.activo !== false)) return toast('Primero crea los productos en Inventario');
  const f = formModal('Ingresar inventario', `
    <div class="fila">
      ${selector('Tipo de ingreso', 'tipo', TIPOS_INGRESO.map(t => ({ v: t, t })), TIPOS_INGRESO[0])}
      ${campo('Fecha', 'fecha', isoDia(new Date()), 'type="date" required')}
    </div>
    <div class="fila">
      ${selector('Proveedor', 'proveedorId', [{ v: '', t: '— Sin proveedor —' }, ...[...db.proveedores].sort(porNombre).map(p => ({ v: p.id, t: p.nombre }))], '')}
      ${campo('N.º factura', 'factura', '')}
    </div>
    <p class="small muted">Agrega una línea por producto con la cantidad recibida (ml o unidades) y el valor total pagado por esa línea. El costo promedio se actualiza solo. Si no sabes el valor, déjalo vacío.</p>
    <div id="lineas-compra">${filaCompra()}</div>
    <button type="button" class="btn block" onclick="$('#lineas-compra').insertAdjacentHTML('beforeend', filaCompra());totalCompra()">+ Otro producto</button>
    <div class="total" id="compra-total"></div>
    ${campo('Nota', 'nota', '')}`,
  d => {
    const lineas = [...document.querySelectorAll('.fila-compra')].map(e => ({
      insumoId: e.querySelector('[name=insumo]').value, cantidad: num(e.querySelector('[name=cant]').value), valor: num(e.querySelector('[name=valor]').value),
    })).filter(l => l.insumoId && l.cantidad > 0);
    if (!lineas.length) { toast('Agrega al menos un producto con cantidad'); return false; }
    const fechaSel = parseDia(d.fecha);
    const ahora = new Date();
    fechaSel.setHours(ahora.getHours(), ahora.getMinutes());
    const c = { id: uid(), fecha: fechaSel.toISOString(), tipo: d.tipo, proveedorId: d.proveedorId || null, factura: d.factura.trim(), nota: d.nota.trim(), userId: sesion.id, items: [], total: 0 };
    for (const l of lineas) {
      const i = byId(db.insumos, l.insumoId);
      if (l.valor > 0) { // costo promedio ponderado
        const st = Math.max(0, num(i.stock));
        i.costo = (st * num(i.costo) + l.valor) / (st + l.cantidad);
      }
      moverStock(i.id, l.cantidad, 'ingreso', `${d.tipo}${c.factura ? ' fact. ' + c.factura : ''}`);
      if (c.proveedorId && !i.proveedorId) i.proveedorId = c.proveedorId;
      nube.put('insumos', i);
      c.items.push({ insumoId: i.id, nombre: i.nombre, unidad: i.unidad, cantidad: l.cantidad, valor: l.valor });
      c.total += l.valor;
    }
    db.compras.push(c);
    nube.agregar('compras', c);
    guardar();
    rerender();
    toast('Inventario ingresado y stock actualizado');
  });
  totalCompra();
  return f;
}
function verCompra(id) {
  const c = byId(db.compras, id);
  modal('Ingreso de inventario', `
    <div class="kv"><span>Tipo</span><b>${esc(c.tipo || 'Compra a proveedor')}</b><span>Proveedor</span><b>${esc(byId(db.proveedores, c.proveedorId)?.nombre || '—')}</b><span>Fecha</span><b>${fechaCorta(c.fecha)}</b>
    ${c.factura ? `<span>Factura</span><b>${esc(c.factura)}</b>` : ''}<span>Registró</span><b>${esc(nombreUsuario(c.userId))}</b></div>
    <table class="tabla"><tr><th>Insumo</th><th class="der">Cant.</th><th class="der">Valor</th></tr>
      ${c.items.map(l => `<tr><td>${esc(l.nombre)}</td><td class="der">${fmtNum(l.cantidad)} ${l.unidad}</td><td class="der">${money(l.valor)}</td></tr>`).join('')}
      <tr class="tot"><td colspan="2">Total</td><td class="der">${money(c.total)}</td></tr></table>
    ${c.nota ? `<p class="small">${esc(c.nota)}</p>` : ''}`);
}

// ---------------------------------------------------------------- GASTOS
// Gastos del negocio (arriendo, servicios, sueldos, domicilios…). Las compras de inventario NO van aquí:
// su costo ya se descuenta al vender. Los vendedores registran y ven sus gastos; el supervisor ve todos.
let gastosMes = isoDia(new Date()).slice(0, 7);

function vGastos() {
  const [y, m] = gastosMes.split('-').map(Number);
  const gs = gastosEn({ ini: new Date(y, m - 1, 1), fin: new Date(y, m, 1) }, esSup() ? null : sesion.id)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const total = gs.reduce((s, g) => s + num(g.valor), 0);
  const porCat = {};
  for (const g of gs) porCat[g.categoria] = (porCat[g.categoria] || 0) + num(g.valor);
  return `
    <button class="btn primary block grande" onclick="editarGasto()" style="margin-bottom:.75rem">💸 Registrar gasto</button>
    <div class="card fila">
      <label>Mes<input type="month" value="${gastosMes}" onchange="gastosMes=this.value||isoDia(new Date()).slice(0,7);render()"></label>
      <div class="kpi"><small>Total ${esSup() ? 'del mes' : '(mis gastos)'}</small><b>${money(total)}</b></div>
    </div>
    ${tablaSimple('Por categoría', Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([c, t]) => [esc(c), money(t)]), ['Categoría', 'Total'])}
    <ul class="lista card">${gs.map(g => `<li class="click" onclick="verGasto('${g.id}')">
      <div><b>${esc(g.descripcion || g.categoria)}</b><br><small class="muted">${fechaCorta(g.fecha)} · ${esc(g.categoria)}${esSup() ? ' · ' + esc(nombreUsuario(g.userId)) : ''}</small></div>
      <div class="der">${money(g.valor)}</div></li>`).join('') || vacio('No hay gastos en este mes')}</ul>
    <p class="small muted">Las compras de esencias, frascos y demás insumos se registran en <b>Ingreso de inventario</b>, no como gasto.</p>`;
}

const buscarGasto = id => byId(db.gastos, id) || NUBE.historico.gastos.get(id);

function editarGasto(id) {
  const g = id ? buscarGasto(id) : { fecha: new Date().toISOString(), categoria: CATEGORIAS_GASTO[0], metodoPago: METODOS[0] };
  formModal(id ? 'Editar gasto' : 'Registrar gasto', `
    <div class="fila">
      ${campo('Fecha', 'fecha', isoDia(g.fecha), 'type="date" required')}
      ${selector('Categoría', 'categoria', CATEGORIAS_GASTO.map(c => ({ v: c, t: c })), g.categoria)}
    </div>
    ${campo('Descripción *', 'descripcion', g.descripcion, 'required placeholder="Ej: Arriendo de octubre, recibo de luz, domicilio"')}
    <div class="fila">
      ${campo('Valor ($) *', 'valor', g.valor || '', 'type="number" step="any" inputmode="numeric" required min="1"')}
      ${selector('Forma de pago', 'metodoPago', METODOS.map(m => ({ v: m, t: m })), g.metodoPago)}
    </div>
    ${esSup() ? selector('Pagado a (proveedor, opcional)', 'proveedorId', [{ v: '', t: '— Ninguno —' }, ...[...db.proveedores].sort(porNombre).map(p => ({ v: p.id, t: p.nombre }))], g.proveedorId) : ''}
    ${campo('Nota', 'nota', g.nota)}`,
  d => {
    if (num(d.valor) <= 0) { toast('Indica el valor del gasto'); return false; }
    const fecha = parseDia(d.fecha);
    const ref = new Date(id ? g.fecha : Date.now());
    fecha.setHours(ref.getHours(), ref.getMinutes());
    const datos = {
      fecha: fecha.toISOString(), categoria: d.categoria, descripcion: d.descripcion.trim(), valor: num(d.valor),
      metodoPago: d.metodoPago, proveedorId: d.proveedorId || g.proveedorId || null, nota: d.nota.trim(),
    };
    if (id) { Object.assign(g, datos); nube.put('gastos', g); }
    else {
      const n = { id: uid(), ...datos, userId: sesion.id, creado: new Date().toISOString() };
      db.gastos.push(n);
      nube.agregar('gastos', n);
    }
    guardar();
    rerender();
    toast('Gasto guardado');
  });
}

function verGasto(id) {
  const g = buscarGasto(id);
  modal('Gasto', `
    <div class="kv">
      <span>Fecha</span><b>${fechaCorta(g.fecha)}</b>
      <span>Categoría</span><b>${esc(g.categoria)}</b>
      <span>Descripción</span><b>${esc(g.descripcion)}</b>
      <span>Valor</span><b>${money(g.valor)}</b>
      <span>Forma de pago</span><b>${esc(g.metodoPago)}</b>
      ${g.proveedorId ? `<span>Pagado a</span><b>${esc(byId(db.proveedores, g.proveedorId)?.nombre || '—')}</b>` : ''}
      <span>Registró</span><b>${esc(nombreUsuario(g.userId))}</b>
    </div>
    ${g.nota ? `<p class="small">${esc(g.nota)}</p>` : ''}
    ${esSup() ? `<div class="acciones"><button class="btn" onclick="editarGasto('${id}')">✏️ Editar</button><button class="btn danger" onclick="eliminarGasto('${id}')">Eliminar</button></div>` : ''}`);
}

function eliminarGasto(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  db.gastos = db.gastos.filter(g => g.id !== id);
  NUBE.historico.gastos.delete(id);
  nube.quitar('gastos', id);
  guardar();
  cerrarModal();
  rerender();
  toast('Gasto eliminado');
}

// ---------------------------------------------------------------- CLIENTES
let cliBuscar = '';

function vClientes() {
  return `
    <div class="card fila">
      <input placeholder="🔍 Buscar por nombre, teléfono o documento" value="${esc(cliBuscar)}" oninput="cliBuscar=this.value;$('#cli-lista').innerHTML=listaClientes()">
      <button class="btn primary" style="flex:0 0 auto" onclick="editarCliente()">+ Nuevo</button>
    </div>
    <p class="small muted">${db.clientes.length} cliente(s) registrados</p>
    <ul class="lista card" id="cli-lista">${listaClientes()}</ul>`;
}
function listaClientes() {
  const q = cliBuscar.trim().toLowerCase();
  return clientesOrdenados().filter(c => `${c.nombre} ${c.telefono || ''} ${c.documento || ''}`.toLowerCase().includes(q)).map(c => {
    return `<li class="click" onclick="verCliente('${c.id}')"><div><b>${esc(c.nombre)}</b><br><small class="muted">${esc(c.telefono || 'Sin teléfono')}${c.documento ? ' · ' + esc(c.documento) : ''}</small></div><div class="der"><small class="muted">${esc(nombreUsuario(c.creadoPor).split(' ')[0])}</small></div></li>`;
  }).join('') || vacio('No hay clientes');
}
function editarCliente(id, alGuardar) {
  const c = id ? byId(db.clientes, id) : {};
  formModal(id ? 'Editar cliente' : 'Nuevo cliente', `
    ${campo('Nombre completo *', 'nombre', c.nombre, 'required')}
    <div class="fila">${campo('Teléfono / WhatsApp', 'telefono', c.telefono, 'type="tel" inputmode="tel"')}${campo('Documento', 'documento', c.documento, 'inputmode="numeric"')}</div>
    <div class="fila">${campo('Correo', 'email', c.email, 'type="email"')}${campo('Cumpleaños', 'cumple', c.cumple, 'type="date"')}</div>
    ${campo('Dirección', 'direccion', c.direccion)}
    ${area('Preferencias / notas', 'notas', c.notas)}`,
  d => {
    const datos = { nombre: d.nombre.trim(), telefono: d.telefono.trim(), documento: d.documento.trim(), email: d.email.trim(), cumple: d.cumple, direccion: d.direccion.trim(), notas: d.notas.trim() };
    const dup = db.clientes.find(x => x.id !== id && ((datos.telefono && x.telefono === datos.telefono) || (datos.documento && x.documento === datos.documento)));
    if (dup && !confirm(`Ya existe un cliente con ese teléfono o documento: ${dup.nombre}.\n¿Guardar de todas formas?`)) return false;
    let cid = id;
    if (id) { Object.assign(c, datos); nube.put('clientes', c); }
    else {
      cid = uid();
      const n = { id: cid, ...datos, creadoPor: sesion.id, fecha: new Date().toISOString() };
      db.clientes.push(n);
      nube.agregar('clientes', n);
    }
    guardar();
    toast('Cliente guardado');
    if (alGuardar) alGuardar(cid);
    else if (['clientes', 'inicio'].includes(vistaActual())) rerender();
  });
}
function verCliente(id) {
  const c = byId(db.clientes, id);
  modal(c.nombre, `
    <div class="kv">
      ${c.telefono ? `<span>Teléfono</span><b><a href="https://wa.me/57${esc(c.telefono.replace(/\D/g, '').replace(/^57/, ''))}">${esc(c.telefono)}</a></b>` : ''}
      ${c.documento ? `<span>Documento</span><b>${esc(c.documento)}</b>` : ''}
      ${c.email ? `<span>Correo</span><b>${esc(c.email)}</b>` : ''}
      ${c.cumple ? `<span>Cumpleaños</span><b>${parseDia(c.cumple).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}</b>` : ''}
      ${c.direccion ? `<span>Dirección</span><b>${esc(c.direccion)}</b>` : ''}
      <span>Registrado por</span><b>${esc(nombreUsuario(c.creadoPor))}</b>
      <span>Total comprado</span><b id="cli-total">…</b>
    </div>
    ${c.notas ? `<p class="small">${esc(c.notas)}</p>` : ''}
    <div class="acciones"><button class="btn" onclick="editarCliente('${id}')">✏️ Editar</button>
    ${esSup() ? `<button class="btn danger" onclick="eliminarCliente('${id}')">Eliminar</button>` : ''}</div>
    <h4 id="cli-ncompras">Compras</h4>
    <ul class="lista mini" id="cli-compras">${vacio('Cargando…')}</ul>`);
  ventasDeCliente(id).then(todas => {
    if (!$('#cli-compras')) return;
    const vs = todas.filter(v => !v.anulada).sort((a, b) => b.fecha.localeCompare(a.fecha));
    vs.forEach(v => ventasVistas.set(v.id, v));
    $('#cli-total').textContent = money(vs.reduce((s, v) => s + v.total, 0));
    $('#cli-ncompras').textContent = `Compras (${vs.length})`;
    $('#cli-compras').innerHTML = vs.slice(0, 20).map(v => `<li class="click" onclick="verVenta('${v.id}')"><div>#${v.numero} · ${fechaCorta(v.fecha)}<br><small class="muted">${v.items.map(l => esc(l.nombre)).join(', ')}</small></div><div class="der">${money(v.total)}</div></li>`).join('') || vacio('Sin compras');
  }).catch(() => { if ($('#cli-compras')) $('#cli-compras').innerHTML = vacio('Sin conexión para ver el historial'); });
}
async function eliminarCliente(id) {
  try {
    if ((await ventasDeCliente(id)).length) return toast('No se puede eliminar: tiene ventas registradas');
  } catch { return toast('Sin conexión: inténtalo más tarde'); }
  if (!confirm('¿Eliminar este cliente?')) return;
  db.clientes = db.clientes.filter(c => c.id !== id);
  nube.quitar('clientes', id);
  guardar();
  cerrarModal();
  rerender();
}

// ---------------------------------------------------------------- PROVEEDORES (solo supervisor)
function vProveedores() {
  const ps = [...db.proveedores].sort(porNombre);
  return `
    <button class="btn primary block grande" onclick="editarProveedor()" style="margin-bottom:.75rem">+ Nuevo proveedor</button>
    <ul class="lista card">${ps.map(p => {
      const total = db.compras.filter(c => c.proveedorId === p.id).reduce((s, c) => s + c.total, 0);
      return `<li class="click" onclick="verProveedor('${p.id}')"><div><b>${esc(p.nombre)}</b><br><small class="muted">${esc(p.suministra || p.telefono || '')}</small></div><div class="der"><small class="muted">Comprado</small><br>${money(total)}</div></li>`;
    }).join('') || vacio('No hay proveedores registrados')}</ul>`;
}
function editarProveedor(id) {
  const p = id ? byId(db.proveedores, id) : {};
  formModal(id ? 'Editar proveedor' : 'Nuevo proveedor', `
    ${campo('Nombre / razón social *', 'nombre', p.nombre, 'required')}
    <div class="fila">${campo('NIT', 'nit', p.nit)}${campo('Persona de contacto', 'contacto', p.contacto)}</div>
    <div class="fila">${campo('Teléfono', 'telefono', p.telefono, 'type="tel" inputmode="tel"')}${campo('Correo', 'email', p.email, 'type="email"')}</div>
    ${campo('Dirección / ciudad', 'direccion', p.direccion)}
    ${campo('Qué suministra', 'suministra', p.suministra, 'placeholder="Ej: esencias, frascos, alcohol"')}
    ${area('Notas (condiciones, tiempos de entrega…)', 'notas', p.notas)}`,
  d => {
    const datos = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim()]));
    if (id) { Object.assign(p, datos); nube.put('proveedores', p); }
    else {
      const n = { id: uid(), ...datos, fecha: new Date().toISOString() };
      db.proveedores.push(n);
      nube.agregar('proveedores', n);
    }
    guardar();
    rerender();
    toast('Proveedor guardado');
  });
}
function verProveedor(id) {
  const p = byId(db.proveedores, id);
  const cs = db.compras.filter(c => c.proveedorId === id).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const insumos = db.insumos.filter(i => i.proveedorId === id);
  modal(p.nombre, `
    <div class="kv">
      ${p.nit ? `<span>NIT</span><b>${esc(p.nit)}</b>` : ''}
      ${p.contacto ? `<span>Contacto</span><b>${esc(p.contacto)}</b>` : ''}
      ${p.telefono ? `<span>Teléfono</span><b>${esc(p.telefono)}</b>` : ''}
      ${p.email ? `<span>Correo</span><b>${esc(p.email)}</b>` : ''}
      ${p.direccion ? `<span>Dirección</span><b>${esc(p.direccion)}</b>` : ''}
      ${p.suministra ? `<span>Suministra</span><b>${esc(p.suministra)}</b>` : ''}
      <span>Total comprado</span><b>${money(cs.reduce((s, c) => s + c.total, 0))}</b>
    </div>
    ${p.notas ? `<p class="small">${esc(p.notas)}</p>` : ''}
    ${insumos.length ? `<p class="small muted">Insumos: ${insumos.map(i => esc(i.nombre)).join(', ')}</p>` : ''}
    <div class="acciones"><button class="btn" onclick="editarProveedor('${id}')">✏️ Editar</button><button class="btn danger" onclick="eliminarProveedor('${id}')">Eliminar</button></div>
    <h4>Compras (${cs.length})</h4>
    <ul class="lista mini">${cs.slice(0, 20).map(c => `<li class="click" onclick="verCompra('${c.id}')"><div>${fechaCorta(c.fecha)}${c.factura ? ' · Fact. ' + esc(c.factura) : ''}</div><div class="der">${money(c.total)}</div></li>`).join('') || vacio('Sin compras')}</ul>`);
}
function eliminarProveedor(id) {
  if (db.compras.some(c => c.proveedorId === id)) return toast('No se puede eliminar: tiene compras registradas');
  if (!confirm('¿Eliminar este proveedor?')) return;
  db.proveedores = db.proveedores.filter(p => p.id !== id);
  nube.quitar('proveedores', id);
  db.insumos.forEach(i => { if (i.proveedorId === id) { i.proveedorId = null; nube.put('insumos', i); } });
  guardar();
  cerrarModal();
  rerender();
}

// ---------------------------------------------------------------- REPORTES
const rep = { periodo: 'dia', fecha: isoDia(new Date()), vendedor: '' };

function calcularReporte() {
  const r = rango(rep.periodo, parseDia(rep.fecha));
  const userId = esSup() ? (rep.vendedor || null) : sesion.id;
  const vs = ventasEn(r, userId);
  const R = {
    r, vs, anuladas: ventasEn(r, userId, true).filter(v => v.anulada).length,
    total: 0, descuentos: 0, costo: 0, perfumes: 0, obsequios: 0, costoObsequios: 0,
    porPago: {}, porVendedor: {}, porRef: {}, porFrasco: {}, porDia: {}, obsequiosDet: {}, consumo: {},
  };
  for (const v of vs) {
    R.total += v.total;
    R.descuentos += v.descuento;
    R.costo += v.costo;
    R.porPago[v.metodoPago] = (R.porPago[v.metodoPago] || 0) + v.total;
    const pv = R.porVendedor[nombreUsuario(v.userId)] ||= { n: 0, total: 0 };
    pv.n++; pv.total += v.total;
    const dia = isoDia(v.fecha);
    R.porDia[dia] = (R.porDia[dia] || 0) + v.total;
    for (const l of v.items) {
      for (const [id, q] of Object.entries(l.consumo || {})) R.consumo[id] = (R.consumo[id] || 0) + q;
      if (l.obsequio) {
        const unidades = l.unidad === 'und' ? l.cant : 1;
        R.obsequios += unidades;
        R.costoObsequios += l.costo;
        const o = R.obsequiosDet[`${l.nombre} (${l.detalle})`] ||= { cant: 0, costo: 0, unidad: l.unidad };
        o.cant += l.cant; o.costo += l.costo;
        continue;
      }
      if (l.tipo === 'perfume') {
        R.perfumes += l.cant;
        const pr = R.porRef[l.nombre] ||= { cant: 0, total: 0 };
        pr.cant += l.cant; pr.total += l.cant * l.precio;
        R.porFrasco[l.detalle] = (R.porFrasco[l.detalle] || 0) + l.cant;
      }
    }
  }
  // Gastos y compras de inventario: solo los ve el supervisor
  R.gastos = esSup() ? gastosEn(r, rep.vendedor || null).sort((a, b) => a.fecha.localeCompare(b.fecha)) : [];
  R.totalGastos = R.gastos.reduce((s, g) => s + num(g.valor), 0);
  R.gastosPorCat = {};
  for (const g of R.gastos) R.gastosPorCat[g.categoria] = (R.gastosPorCat[g.categoria] || 0) + num(g.valor);
  R.totalCompras = esSup() && !rep.vendedor
    ? db.compras.filter(c => { const f = new Date(c.fecha); return f >= r.ini && f < r.fin; }).reduce((s, c) => s + num(c.total), 0)
    : 0;
  R.utilidadNeta = R.total - R.costo - R.totalGastos;
  return R;
}

function tablaSimple(titulo, filas, cabeceras) {
  if (!filas.length) return '';
  return `<section class="card"><h3>${titulo}</h3><table class="tabla"><tr>${cabeceras.map((c, i) => `<th class="${i ? 'der' : ''}">${c}</th>`).join('')}</tr>
    ${filas.map(f => `<tr>${f.map((c, i) => `<td class="${i ? 'der' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table></section>`;
}

function vReportes() {
  const R = calcularReporte();
  const vendedores = db.usuarios.filter(u => db.ventas.some(v => v.userId === u.id) || u.activo).sort(porNombre);
  const ticket = R.vs.length ? R.total / R.vs.length : 0;
  const dias = Object.entries(R.porDia).sort();
  const maxDia = Math.max(1, ...dias.map(d => d[1]));
  const sup = esSup();

  return `
    <div class="card no-print">
      <div class="tabs">${[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']].map(([k, t]) => `<button class="${rep.periodo === k ? 'activo' : ''}" onclick="rep.periodo='${k}';rerender()">${t}</button>`).join('')}</div>
      <div class="fila">
        <label>Fecha de referencia<input type="date" value="${rep.fecha}" onchange="rep.fecha=this.value||isoDia(new Date());rerender()"></label>
        ${sup ? selector('Vendedor', 'vend', [{ v: '', t: 'Todos' }, ...vendedores.map(u => ({ v: u.id, t: u.nombre }))], rep.vendedor, 'onchange="rep.vendedor=this.value;rerender()"') : ''}
      </div>
      <div class="acciones" style="margin-top:0">
        <button class="btn" onclick="compartirTexto(textoReporte())">📤 Compartir</button>
        <button class="btn" onclick="imprimir('Reporte de ventas')">🖨 PDF / Imprimir</button>
        <button class="btn" onclick="exportarCSV()">📄 Excel (CSV)</button>
      </div>
    </div>

    <h3 style="margin:.4rem .2rem .6rem">Reporte de ventas · ${esc(etiquetaRango(R.r))}${!sup ? `<br><small class="muted">Vendedor: ${esc(sesion.nombre)}</small>` : rep.vendedor ? `<br><small class="muted">Vendedor: ${esc(nombreUsuario(rep.vendedor))}</small>` : ''}</h3>
    <div class="kpis">
      <div class="kpi destacado"><small>Total vendido</small><b>${money(R.total)}</b></div>
      <div class="kpi"><small>N.º de ventas</small><b>${R.vs.length}</b></div>
      <div class="kpi"><small>Perfumes vendidos</small><b>${R.perfumes}</b></div>
      <div class="kpi"><small>Ticket promedio</small><b>${money(ticket)}</b></div>
      <div class="kpi"><small>Obsequios entregados</small><b>${R.obsequios}</b></div>
      <div class="kpi"><small>Descuentos</small><b>${money(R.descuentos)}</b></div>
      ${sup ? `<div class="kpi"><small>Gastos</small><b>${money(R.totalGastos)}</b></div>
      <div class="kpi"><small>Utilidad neta</small><b class="${R.utilidadNeta < 0 ? 'rojo' : 'verde'}">${money(R.utilidadNeta)}</b></div>` : ''}
    </div>
    ${NUBE.cargandoHist ? '<div class="aviso">⏳ Trayendo datos anteriores desde la nube…</div>' : ''}
    ${sup ? `<section class="card"><h3>Resultado del periodo</h3><table class="tabla">
      <tr><td>Ventas</td><td class="der">${money(R.total)}</td></tr>
      <tr><td>− Costo de insumos vendidos <small class="muted">(esencia, alcohol, fijador, frascos y obsequios)</small></td><td class="der">${money(R.costo)}</td></tr>
      <tr><td><b>= Utilidad bruta</b></td><td class="der"><b>${money(R.total - R.costo)}</b></td></tr>
      <tr><td>− Gastos${rep.vendedor ? ' <small class="muted">(registrados por este vendedor)</small>' : ''}</td><td class="der">${money(R.totalGastos)}</td></tr>
      <tr class="tot"><td>= Utilidad neta</td><td class="der ${R.utilidadNeta < 0 ? 'rojo' : 'verde'}">${money(R.utilidadNeta)}</td></tr>
    </table>
    ${!rep.vendedor ? `<p class="small muted">Dinero invertido en inventario en el periodo: <b>${money(R.totalCompras)}</b> (no se resta aquí: su costo se descuenta a medida que se vende).</p>` : ''}
    </section>` : ''}
    ${R.anuladas ? `<p class="small muted">${R.anuladas} venta(s) anulada(s) no incluidas.</p>` : ''}

    ${rep.periodo !== 'dia' && dias.length ? `<section class="card"><h3>Ventas por día</h3><div class="barras">
      ${dias.map(([d, t]) => `<div class="barra"><span>${parseDia(d).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' })}</span><i style="width:${t / maxDia * 100}%"></i><b>${money(t)}</b></div>`).join('')}
    </div></section>` : ''}
    ${tablaSimple('Por forma de pago', Object.entries(R.porPago).sort((a, b) => b[1] - a[1]).map(([m, t]) => [esc(m), money(t)]), ['Forma de pago', 'Total'])}
    ${sup && !rep.vendedor ? tablaSimple('Por vendedor', Object.entries(R.porVendedor).sort((a, b) => b[1].total - a[1].total).map(([n, x]) => [esc(n), x.n, money(x.total)]), ['Vendedor', 'Ventas', 'Total']) : ''}
    ${tablaSimple('Referencias más vendidas', Object.entries(R.porRef).sort((a, b) => b[1].cant - a[1].cant).slice(0, 15).map(([n, x]) => [esc(n), x.cant, money(x.total)]), ['Referencia', 'Und.', 'Total'])}
    ${tablaSimple('Perfumes por tamaño de frasco', Object.entries(R.porFrasco).sort((a, b) => b[1] - a[1]).map(([n, c]) => [esc(n), c]), ['Frasco', 'Und.'])}
    ${tablaSimple('Obsequios entregados', Object.entries(R.obsequiosDet).map(([n, x]) => sup ? [esc(n), `${fmtNum(x.cant)} ${x.unidad}`, money(x.costo)] : [esc(n), `${fmtNum(x.cant)} ${x.unidad}`]), sup ? ['Obsequio', 'Cant.', 'Costo'] : ['Obsequio', 'Cant.'])}
    ${tablaSimple('Gastos por categoría', Object.entries(R.gastosPorCat).sort((a, b) => b[1] - a[1]).map(([c, t]) => [esc(c), money(t)]), ['Categoría', 'Total'])}
    ${sup ? tablaSimple('Consumo de insumos', Object.entries(R.consumo).map(([id, q]) => ({ i: byId(db.insumos, id), q })).filter(x => x.i).sort((a, b) => porNombre(a.i, b.i)).map(x => [esc(x.i.nombre), `${fmtNum(x.q)} ${x.i.unidad}`, money(x.q * num(x.i.costo))]), ['Insumo', 'Cantidad', 'Costo actual']) : ''}

    <section class="card"><h3>Detalle de ventas (${R.vs.length})</h3>
      <ul class="lista">${[...R.vs].reverse().map(v => filaVenta(v).replace(`· ${hora(v.fecha)}`, `· ${rep.periodo === 'dia' ? '' : fechaCorta(v.fecha) + ' '}${hora(v.fecha)}`)).join('') || vacio('No hay ventas en este periodo')}</ul>
    </section>`;
}

function textoReporte() {
  const R = calcularReporte();
  const L = [`*${db.config.negocio}*`, `Reporte de ventas - ${etiquetaRango(R.r)}`];
  if (!esSup()) L.push(`Vendedor: ${sesion.nombre}`);
  else if (rep.vendedor) L.push(`Vendedor: ${nombreUsuario(rep.vendedor)}`);
  L.push('', `Total vendido: ${money(R.total)}`, `Ventas: ${R.vs.length}`, `Perfumes vendidos: ${R.perfumes}`, `Obsequios: ${R.obsequios}`);
  if (R.descuentos) L.push(`Descuentos: ${money(R.descuentos)}`);
  if (esSup()) L.push(`Utilidad bruta: ${money(R.total - R.costo)}`, `Gastos: ${money(R.totalGastos)}`, `*Utilidad neta: ${money(R.utilidadNeta)}*`);
  const pagos = Object.entries(R.porPago);
  if (pagos.length) { L.push('', '*Por forma de pago*'); for (const [m, t] of pagos) L.push(`${m}: ${money(t)}`); }
  const top = Object.entries(R.porRef).sort((a, b) => b[1].cant - a[1].cant).slice(0, 5);
  if (top.length) { L.push('', '*Más vendidos*'); for (const [n, x] of top) L.push(`${n}: ${x.cant}`); }
  return L.join('\n');
}

function exportarCSV() {
  const R = calcularReporte();
  const filas = [['Venta', 'Fecha', 'Hora', 'Vendedor', 'Cliente', 'Producto', 'Detalle', 'Cantidad', 'Unidad', 'Obsequio', 'Precio unitario', 'Subtotal línea', 'Descuento venta', 'Total venta', 'Forma de pago']];
  for (const v of R.vs) for (const l of v.items) {
    filas.push([v.numero, isoDia(v.fecha), hora(v.fecha), nombreUsuario(v.userId), nombreCliente(v.clienteId), l.nombre, l.detalle, l.cant, l.unidad, l.obsequio ? 'Sí' : 'No', l.precio, l.cant * l.precio, v.descuento, v.total, v.metodoPago]);
  }
  if (R.gastos.length) {
    filas.push([], ['GASTOS'], ['Fecha', 'Categoría', 'Descripción', 'Valor', 'Forma de pago', 'Registró']);
    for (const g of R.gastos) filas.push([isoDia(g.fecha), g.categoria, g.descripcion, g.valor, g.metodoPago, nombreUsuario(g.userId)]);
  }
  const csv = '﻿' + filas.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  descargar(`ventas_${rep.periodo}_${rep.fecha}.csv`, csv, 'text/csv');
}

// ---------------------------------------------------------------- USUARIOS (solo supervisor)
function vUsuarios() {
  const us = [...db.usuarios].sort((a, b) => (b.activo - a.activo) || porNombre(a, b));
  return `
    <button class="btn primary block grande" onclick="editarUsuario()" style="margin-bottom:.75rem">+ Nuevo usuario</button>
    <ul class="lista card">${us.map(u => `<li class="click" onclick="editarUsuario('${u.id}')" style="${u.activo ? '' : 'opacity:.5'}">
      <div><b>${esc(u.nombre)}</b> ${u.id === sesion.id ? '<small class="muted">(tú)</small>' : ''}<br><small class="muted">Usuario: ${esc(u.usuario)}</small></div>
      <div class="der"><span class="tag ${u.rol === 'supervisor' ? 'sup' : ''}">${u.rol === 'supervisor' ? 'Supervisor' : 'Vendedor'}</span>${u.activo ? '' : '<br><small>Inactivo</small>'}</div></li>`).join('')}</ul>
    <p class="small muted">Los vendedores pueden registrar ventas y clientes, ver inventario y sacar reportes de sus propias ventas. Todos pueden registrar gastos (el vendedor ve solo los suyos). Los supervisores además ingresan inventario, gestionan referencias, proveedores y usuarios, y ven costos, gastos y utilidades.</p>`;
}
function editarUsuario(id) {
  const u = id ? byId(db.usuarios, id) : { rol: 'vendedor', activo: true };
  formModal(id ? 'Editar usuario' : 'Nuevo usuario', `
    ${campo('Nombre *', 'nombre', u.nombre, 'required')}
    <div class="fila">${campo('Usuario (para ingresar) *', 'usuario', u.usuario, 'required autocapitalize="none"')}${selector('Rol', 'rol', [{ v: 'vendedor', t: 'Vendedor' }, { v: 'supervisor', t: 'Supervisor' }], u.rol)}</div>
    ${campo(id ? 'Nuevo PIN (vacío = no cambiar)' : 'PIN (mínimo 4 dígitos) *', 'pin', '', `type="password" inputmode="numeric" ${id ? '' : 'required'}`)}
    ${id ? casilla('Usuario activo', 'activo', u.activo) : ''}`,
  d => {
    const usuario = d.usuario.trim().toLowerCase();
    if (db.usuarios.some(x => x.id !== id && x.usuario.toLowerCase() === usuario)) { toast('Ese nombre de usuario ya existe'); return false; }
    if (d.pin && d.pin.length < 4) { toast('El PIN debe tener al menos 4 dígitos'); return false; }
    const activo = id ? !!d.activo : true;
    const quedaSup = db.usuarios.some(x => x.id !== id && x.activo && x.rol === 'supervisor') || (d.rol === 'supervisor' && activo);
    if (!quedaSup) { toast('Debe quedar al menos un supervisor activo'); return false; }
    if (id) {
      Object.assign(u, { nombre: d.nombre.trim(), usuario, rol: d.rol, activo });
      if (d.pin) { u.pin = hashPin(d.pin); u.debeCambiarPin = u.id !== sesion.id; }
      nube.put('usuarios', u);
    } else {
      const n = { id: uid(), nombre: d.nombre.trim(), usuario, rol: d.rol, pin: hashPin(d.pin), activo: true, debeCambiarPin: true };
      db.usuarios.push(n);
      nube.agregar('usuarios', n);
    }
    guardar();
    if (id === sesion.id && (!activo || d.rol !== 'supervisor')) { salir(); return; }
    renderShell();
    render();
    toast('Usuario guardado');
  });
}

// ---------------------------------------------------------------- AJUSTES Y RESPALDO (solo supervisor)
function vAjustes() {
  const c = db.config;
  const opc = tipo => db.insumos.filter(i => i.tipo === tipo).map(i => ({ v: i.id, t: i.nombre }));
  return `
    <form class="card" id="f-ajustes">
      <h3>Negocio</h3>
      ${campo('Nombre de la perfumería', 'negocio', c.negocio, 'required')}
      <div class="fila">${campo('NIT', 'nit', c.nit)}${campo('Teléfono', 'telefono', c.telefono)}</div>
      ${campo('Mensaje al final del recibo', 'mensajeRecibo', c.mensajeRecibo)}
      <h3>Mezcla general de los perfumes</h3>
      <p class="small muted">Se usa para descontar insumos al vender. Cada referencia puede tener su propia mezcla.</p>
      <div class="fila">
        ${campo('% de esencia', 'pctEsencia', c.pctEsencia, 'type="number" step="any" inputmode="decimal" required')}
        ${campo('% de fijador', 'pctFijador', c.pctFijador, 'type="number" step="any" inputmode="decimal" required')}
      </div>
      <div class="fila">
        ${selector('Alcohol que se descuenta', 'alcoholId', opc('alcohol'), c.alcoholId)}
        ${selector('Fijador que se descuenta', 'fijadorId', opc('fijador'), c.fijadorId)}
      </div>
      <button class="btn primary block">Guardar ajustes</button>
    </form>
    ${NUBE.activa ? `<section class="card">
      <h3>☁️ Datos en la nube</h3>
      <p class="small">Este teléfono está conectado a la cuenta <b>${esc(NUBE.auth.currentUser?.email || '')}</b>. Las ventas, el inventario y los clientes se comparten con los demás teléfonos del negocio. Sin internet la app sigue funcionando y sube los cambios al reconectarse.</p>
      ${datosLocalesPrevios() ? `<p class="small">Este teléfono tiene datos guardados de antes de usar la nube (${datosLocalesPrevios().ventas.length} ventas, ${datosLocalesPrevios().referencias.length} referencias).</p>
        <button class="btn block" onclick="subirDatosLocales()">⬆ Subir esos datos a la nube</button>` : ''}
      <button class="btn block ghost" onclick="desconectarDispositivo()">Desconectar este teléfono</button>
    </section>` : `<section class="card">
      <h3>☁️ Compartir datos entre teléfonos</h3>
      <p class="small">Pega aquí la configuración de Firebase (el bloque <b>firebaseConfig</b> de la consola) para que todos los teléfonos compartan inventario, ventas y gastos. Ver la guía CONFIGURAR-NUBE.</p>
      <textarea id="cfg-firebase" rows="5" placeholder='const firebaseConfig = { apiKey: "…", authDomain: "…", projectId: "…", appId: "…" };'></textarea>
      <button class="btn block" onclick="conectarNube()">Conectar a la nube</button>
    </section>`}
    ${NATIVO?.versionApp ? `<section class="card">
      <h3>🔄 Actualizaciones en línea</h3>
      <p class="small">Versión instalada: <b>${NATIVO.versionApp()}</b>. Cada vez que se abre, la app busca una versión nueva en esta dirección y la instala sola, <b>sin reinstalar el APK</b>. Tus datos no se tocan.</p>
      <label>Dirección de actualizaciones<input id="url-act" value="${esc(NATIVO.urlActualizaciones())}" placeholder="https://TU-USUARIO.github.io/perfumeria/" autocapitalize="none" inputmode="url"></label>
      <div class="acciones">
        <button class="btn" onclick="guardarUrlActualizaciones()">Guardar dirección</button>
        <button class="btn primary" onclick="buscarActualizacionAhora()">Buscar ahora</button>
      </div>
      <p id="estado-act" class="small muted"></p>
    </section>` : ''}
    <section class="card">
      <h3>💾 Copia de seguridad</h3>
      <p class="small">${NUBE.activa
        ? 'Los datos están en la nube, pero conviene guardar una copia propia de vez en cuando (Drive o WhatsApp).'
        : 'Los datos se guardan <b>solo en este teléfono</b>. Si se borra la app o se daña el equipo se pierden, así que haz respaldos con frecuencia y guárdalos en Drive o envíalos por WhatsApp.'}</p>
      <p class="small muted">Último respaldo: ${c.ultimoRespaldo ? fechaHora(c.ultimoRespaldo) : 'nunca'}</p>
      <div class="acciones">
        <button class="btn primary" onclick="exportarRespaldo()">⬇ Exportar respaldo</button>
        <button class="btn" onclick="$('#archivo-respaldo').click()">⬆ Restaurar respaldo</button>
      </div>
      <input type="file" id="archivo-respaldo" accept=".json,application/json" style="display:none" onchange="importarRespaldo(this.files[0]);this.value=''">
    </section>
    <p class="small muted" style="text-align:center">${db.referencias.length} referencias · ${db.insumos.length} insumos · ${db.ventas.length} ventas · ${db.clientes.length} clientes</p>`;
}
VISTAS.ajustes.despues = () => {
  $('#f-ajustes').onsubmit = e => {
    e.preventDefault();
    const d = datosForm(e.target);
    if (num(d.pctEsencia) + num(d.pctFijador) > 100) return toast('Esencia + fijador no puede superar 100%');
    const campos = {
      negocio: d.negocio.trim(), nit: d.nit.trim(), telefono: d.telefono.trim(), mensajeRecibo: d.mensajeRecibo.trim(),
      pctEsencia: num(d.pctEsencia), pctFijador: num(d.pctFijador), alcoholId: d.alcoholId || null, fijadorId: d.fijadorId || null,
    };
    Object.assign(db.config, campos);
    nube.config(campos);
    guardar();
    renderShell();
    render();
    toast('Ajustes guardados');
  };
};
async function exportarRespaldo() {
  let datos;
  try {
    if (NUBE.activa) toast('Descargando todos los datos de la nube…');
    datos = await datosCompletos();
  } catch { return toast('Se necesita internet para descargar el respaldo completo'); }
  db.config.ultimoRespaldo = new Date().toISOString();
  nube.config({ ultimoRespaldo: db.config.ultimoRespaldo });
  guardar();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  descargar(`respaldo_perfumeria_${stamp}.json`, JSON.stringify({ ...datos, config: db.config }), 'application/json');
  rerender();
}
function importarRespaldo(file) {
  if (!file) return;
  const lector = new FileReader();
  lector.onload = async () => {
    try {
      const datos = JSON.parse(lector.result);
      if (!Array.isArray(datos.usuarios) || !Array.isArray(datos.insumos) || !Array.isArray(datos.ventas)) throw new Error('El archivo no es un respaldo válido');
      if (NUBE.activa) {
        if (!confirm(`Se subirán a la nube los datos del respaldo (${datos.ventas.length} ventas, ${datos.referencias?.length || 0} referencias). Los registros iguales se reemplazan y el resto se conserva.\n\n¿Continuar?`)) return;
        toast('Subiendo respaldo…');
        await subirANube(migrar(datos));
        toast('Respaldo subido a la nube');
        return;
      }
      if (!confirm(`Se reemplazarán TODOS los datos actuales por los del respaldo (${datos.ventas.length} ventas, ${datos.referencias?.length || 0} referencias).\n\n¿Continuar?`)) return;
      db = migrar(datos);
      guardar();
      toast('Respaldo restaurado');
      iniciar();
    } catch (e) { alert('No se pudo restaurar: ' + e.message); }
  };
  lector.readAsText(file);
}

// ---- actualizaciones en línea (solo en la app Android)
function guardarUrlActualizaciones(silencioso) {
  const url = $('#url-act').value.trim();
  if (url && !/^https:\/\/\S+$/.test(url)) { toast('La dirección debe empezar por https://'); return false; }
  NATIVO.configurarActualizaciones(url);
  if (!silencioso) toast('Dirección guardada');
  return true;
}
function buscarActualizacionAhora() {
  if (!guardarUrlActualizaciones(true)) return;
  $('#estado-act').textContent = 'Buscando…';
  NATIVO.buscarActualizacion();
}
window.resultadoActualizacion = msg => {
  const texto = msg === 'sin-url' ? 'Primero escribe la dirección de actualizaciones.'
    : msg === 'al-dia' ? 'Ya tienes la última versión ✓'
    : msg === 'instalada' ? 'Versión nueva descargada. Toca el aviso de abajo para aplicarla.'
    : 'No se pudo buscar: revisa la conexión a internet o la dirección.';
  const el = $('#estado-act');
  if (el) el.textContent = texto;
  toast(texto);
};

// ---- conectar este teléfono a Firebase pegando la configuración (sin reinstalar)
function conectarNube() {
  const txt = $('#cfg-firebase').value;
  const cfg = {};
  for (const m of txt.matchAll(/(\w+)\s*["']?\s*:\s*["']([^"']+)["']/g)) cfg[m[1]] = m[2];
  if (!cfg.apiKey || !cfg.projectId) return toast('No encontré apiKey y projectId en el texto pegado');
  if (!confirm(`Se conectará al proyecto "${cfg.projectId}". La app se reiniciará y pedirá el correo y la contraseña del negocio.\n\n¿Continuar?`)) return;
  localStorage.setItem('perfumeria_firebase', JSON.stringify(cfg));
  location.reload();
}

// Datos que el teléfono guardó en modo solo dispositivo (antes de conectar la nube)
function datosLocalesPrevios() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY_DB));
    return d && (d.ventas?.length || d.referencias?.length) ? d : null;
  } catch { return null; }
}
async function subirDatosLocales() {
  const d = datosLocalesPrevios();
  if (!d || !confirm('Se subirán a la nube las ventas, referencias, inventario, clientes y usuarios guardados en este teléfono. ¿Continuar?')) return;
  try {
    toast('Subiendo datos…');
    await subirANube(migrar(d));
    localStorage.setItem(KEY_DB + '_subido', localStorage.getItem(KEY_DB));
    localStorage.removeItem(KEY_DB);
    toast('Datos subidos a la nube');
    rerender();
  } catch (e) { alert('No se pudieron subir: ' + e.message); }
}

// ---------------------------------------------------------------- arranque
if ('serviceWorker' in navigator && !NATIVO && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (NUBE.activa) nubeIniciar();
else iniciar();
