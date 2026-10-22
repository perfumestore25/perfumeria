'use strict';
/*
 * Importación de inventario y perfumes armados desde el formato de Excel (formato_inventario.xlsx).
 * Hoja "Productos": Código (opcional), Nombre, Tipo, Cantidad, Unidad, Capacidad, Costo total, Precio, Stock mínimo.
 * Hoja "Perfumes armados": Código (opcional), Nombre, Esencia/referencia, Frasco, % esencia, % alcohol, % fijador, Precio.
 * Primero se analiza el archivo y se muestra un resumen; nada se guarda hasta pulsar "Importar".
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let planImportacion = null;

function cargarScript(src) {
  return new Promise((ok, mal) => {
    if (document.querySelector(`script[src="${src}"]`) && window.XLSX) return ok();
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => mal(new Error('No se pudo cargar el lector de Excel'));
    document.head.appendChild(s);
  });
}

const normal = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[*\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
const sinPrefijoEsencia = s => String(s).replace(/^\s*esencia\s+(de\s+)?/i, '').trim();

// Números escritos a mano: "250.000", "$ 250.000", "1.5", "2,5"
function numExcel(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[$\s%]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

const TIPO_TEXTO = {
  esencia: 'esencia', esencias: 'esencia', alcohol: 'alcohol', alcoholes: 'alcohol', fijador: 'fijador', fijadores: 'fijador',
  frasco: 'frasco', frascos: 'frasco', envase: 'frasco', otro: 'otro', otros: 'otro', empaque: 'otro', empaques: 'otro',
};

// Lee una hoja y arma objetos según las palabras del encabezado de cada columna
function leerHoja(ws, campos) {
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  const iHead = filas.findIndex(f => f.some(c => normal(c).startsWith('nombre')));
  if (iHead < 0) return [];
  const head = filas[iHead].map(normal);
  const idx = {};
  for (const [clave, palabras] of Object.entries(campos)) idx[clave] = head.findIndex(h => palabras.some(p => h.includes(p)));
  return filas.slice(iHead + 1)
    .map((f, n) => {
      const o = { fila: iHead + n + 2 };
      for (const [k, i] of Object.entries(idx)) o[k] = i >= 0 ? f[i] : '';
      return o;
    })
    .filter(o => String(o.nombre).trim());
}

// ---------------------------------------------------------------- análisis (no guarda nada)
function analizarProductos(filas) {
  const productos = [], errores = [];
  const nuevos = new Map(); // productos nuevos del mismo archivo, por clave tipo|nombre
  for (const f of filas) {
    const nombre = String(f.nombre).trim();
    const tipo = TIPO_TEXTO[normal(f.tipo)];
    const cantidad = String(f.cantidad).trim() === '' ? 0 : numExcel(f.cantidad);
    if (!tipo) { errores.push(`Productos fila ${f.fila}: tipo "${f.tipo}" no válido (usa Esencia, Alcohol, Fijador, Frasco u Otro)`); continue; }
    if (isNaN(cantidad) || cantidad < 0) { errores.push(`Productos fila ${f.fila}: cantidad "${f.cantidad}" no válida`); continue; }
    const codigo = String(f.codigo).trim().toUpperCase();
    const unidadTxt = normal(f.unidad);
    const unidad = ['ml', 'und', 'g'].includes(unidadTxt) ? unidadTxt : unidadTxt.startsWith('unid') ? 'und' : TIPOS[tipo].unidad;
    const opc = v => { const n = numExcel(v); return String(v).trim() === '' || isNaN(n) ? null : n; };
    const capacidad = opc(f.capacidad) ?? (tipo === 'frasco' ? numExcel((nombre.match(/(\d+(?:[.,]\d+)?)\s*ml/i) || [])[1]) : null);
    if (tipo === 'frasco' && !(capacidad > 0)) { errores.push(`Productos fila ${f.fila}: falta la capacidad en ml del frasco "${nombre}"`); continue; }
    const clave = `${tipo}|${normal(nombre)}`;
    const existente = (codigo && db.insumos.find(i => String(i.codigo).toUpperCase() === codigo))
      || db.insumos.find(i => i.tipo === tipo && normal(i.nombre) === normal(nombre));
    const prod = {
      fila: f.fila, nombre, tipo, unidad, cantidad, codigo, capacidad,
      costo: opc(f.costo) || 0, precio: opc(f.precio), stockMin: opc(f.minimo),
      existente: existente || null, repetido: !existente && nuevos.has(clave),
    };
    if (!existente) nuevos.set(clave, true);
    productos.push(prod);
  }
  return { productos, errores };
}

// Busca la esencia/referencia y el frasco de un perfume armado entre lo que hay en la app y lo que trae el archivo
function analizarArmados(filas, productos) {
  const armados = [], errores = [];
  const enArchivo = tipo => productos.filter(p => p.tipo === tipo);
  for (const f of filas) {
    const nombre = String(f.nombre).trim();
    const esTxt = String(f.esencia).trim(), frTxt = String(f.frasco).trim();
    if (!esTxt) { errores.push(`Perfumes armados fila ${f.fila}: falta la esencia`); continue; }
    if (!frTxt) { errores.push(`Perfumes armados fila ${f.fila}: falta el frasco`); continue; }
    let pE = numExcel(f.pE) || 0, pA = numExcel(f.pA) || 0, pF = numExcel(f.pF) || 0;
    if (Math.abs(pE + pA + pF - 1) < 0.001) { pE *= 100; pA *= 100; pF *= 100; } // escritos como 0,5 / 50 %
    if (Math.abs(pE + pA + pF - 100) > 0.01) { errores.push(`Perfumes armados fila ${f.fila}: la mezcla suma ${fmtNum(pE + pA + pF)} % y debe sumar 100 %`); continue; }
    const frExiste = buscarFrasco(frTxt) || enArchivo('frasco').find(p => normal(p.nombre) === normal(frTxt) || normal(p.codigo) === normal(frTxt));
    const capTxt = numExcel((frTxt.match(/(\d+(?:[.,]\d+)?)\s*ml/i) || [])[1]);
    if (!frExiste && !(capTxt > 0)) { errores.push(`Perfumes armados fila ${f.fila}: no encuentro el frasco "${frTxt}" (agrégalo en Productos)`); continue; }
    const codigo = String(f.codigo).trim().toUpperCase();
    const existente = (codigo && db.armados.find(a => String(a.codigo).toUpperCase() === codigo))
      || db.armados.find(a => normal(a.nombre) === normal(nombre));
    armados.push({ fila: f.fila, nombre, codigo, esTxt, frTxt, capTxt, pE, pA, pF, precio: numExcel(f.precio) || 0, existente: existente || null });
  }
  return { armados, errores };
}

function buscarFrasco(txt) {
  const t = normal(txt);
  return db.insumos.find(i => i.tipo === 'frasco' && (normal(i.nombre) === t || normal(i.codigo) === t));
}
function buscarReferencia(txt) {
  const t = normal(sinPrefijoEsencia(txt));
  const ref = db.referencias.find(r => normal(r.nombre) === t || normal(r.codigo) === normal(txt));
  if (ref) return ref;
  const es = db.insumos.find(i => i.tipo === 'esencia' && (normal(sinPrefijoEsencia(i.nombre)) === t || normal(i.codigo) === normal(txt)));
  return es ? referenciaDeEsencia(es) : null;
}

// ---------------------------------------------------------------- aplicar
// Toda esencia necesita una referencia para poder venderse; si no tiene, se crea con su nombre
function referenciaDeEsencia(es) {
  const existe = db.referencias.find(r => r.esenciaId === es.id);
  if (existe) return existe;
  const r = {
    id: uid(), codigo: siguienteCodigo(), nombre: sinPrefijoEsencia(es.nombre) || es.nombre, genero: 'Unisex', inspiracion: '',
    esenciaId: es.id, pctEsencia: null, pctFijador: null, precios: {}, notas: '', activo: true, creada: new Date().toISOString(),
  };
  db.referencias.push(r);
  nube.agregar('referencias', r);
  return r;
}

function crearInsumo(datos) {
  const i = { id: uid(), stock: 0, costo: 0, stockMin: 0, activo: true, ...datos };
  if (!i.codigo || db.insumos.some(x => String(x.codigo).toUpperCase() === i.codigo)) i.codigo = codigoInsumo(i.tipo);
  db.insumos.push(i);
  nube.agregar('insumos', i);
  return i;
}

function aplicarImportacion() {
  const plan = planImportacion;
  if (!plan) return;
  const ingreso = { id: uid(), fecha: new Date().toISOString(), tipo: 'Importación Excel', proveedorId: null, factura: '', nota: plan.archivo, userId: sesion.id, items: [], total: 0 };
  let creados = 0, sumados = 0, armadosN = 0;

  for (const p of plan.productos) {
    let i = (p.existente && byId(db.insumos, p.existente.id)) || db.insumos.find(x => x.tipo === p.tipo && normal(x.nombre) === normal(p.nombre));
    if (!i) {
      i = crearInsumo({
        codigo: p.codigo, tipo: p.tipo, nombre: p.nombre, unidad: p.unidad, capacidad: p.capacidad || 0,
        precioVenta: p.precio || 0, stockMin: p.stockMin ?? 0,
      });
      creados++;
    } else {
      if (p.capacidad && p.tipo === 'frasco') i.capacidad = p.capacidad;
      if (p.precio !== null) i.precioVenta = p.precio;
      if (p.stockMin !== null) i.stockMin = p.stockMin;
      sumados++;
    }
    if (p.cantidad > 0) {
      if (p.costo > 0) {
        const st = Math.max(0, num(i.stock));
        i.costo = (st * num(i.costo) + p.costo) / (st + p.cantidad);
      }
      moverStock(i.id, p.cantidad, 'ingreso', 'Importación Excel');
      ingreso.items.push({ insumoId: i.id, nombre: i.nombre, unidad: i.unidad, cantidad: p.cantidad, valor: p.costo });
      ingreso.total += p.costo;
    }
    nube.put('insumos', i);
    if (i.tipo === 'esencia') referenciaDeEsencia(i);
  }
  if (ingreso.items.length) {
    db.compras.push(ingreso);
    nube.agregar('compras', ingreso);
  }

  for (const a of plan.armados) {
    let ref = buscarReferencia(a.esTxt);
    if (!ref) ref = referenciaDeEsencia(crearInsumo({ tipo: 'esencia', nombre: `Esencia ${sinPrefijoEsencia(a.esTxt)}`, unidad: 'ml', stockMin: 50 }));
    let fr = buscarFrasco(a.frTxt);
    if (!fr) fr = crearInsumo({ tipo: 'frasco', nombre: a.frTxt, unidad: 'und', capacidad: a.capTxt, precioVenta: a.precio });
    const datos = {
      nombre: a.nombre, refId: ref.id, frascoId: fr.id, pctEsencia: a.pE, pctAlcohol: a.pA, pctFijador: a.pF,
      precio: a.precio || precioPerfume(ref, fr),
    };
    const existente = a.existente && byId(db.armados, a.existente.id);
    if (existente) { Object.assign(existente, datos, { activo: true }); nube.put('armados', existente); }
    else {
      const codigo = a.codigo && !db.armados.some(x => String(x.codigo).toUpperCase() === a.codigo) ? a.codigo : codigoArmado();
      const n = { id: uid(), codigo, ...datos, activo: true, creado: new Date().toISOString() };
      db.armados.push(n);
      nube.agregar('armados', n);
    }
    armadosN++;
  }

  guardar();
  planImportacion = null;
  cerrarModal();
  rerender();
  modal('✅ Importación terminada', `
    <div class="kv">
      <span>Productos nuevos</span><b>${creados}</b>
      <span>Productos con stock sumado</span><b>${sumados}</b>
      <span>Perfumes armados</span><b>${armadosN}</b>
      <span>Valor del inventario ingresado</span><b>${money(ingreso.total)}</b>
    </div>
    <p class="small muted">Puedes revisarlo en Inventario, Referencias y Perfumes armados. El ingreso queda registrado en "Ingreso de inventario".</p>
    <button class="btn primary block" onclick="cerrarModal()">Listo</button>`);
}

// ---------------------------------------------------------------- pantalla
async function importarExcel(file) {
  if (!file) return;
  try {
    toast('Leyendo el archivo…');
    await cargarScript('lib/xlsx.full.min.js');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const nombres = wb.SheetNames;
    const hojaP = nombres.find(n => normal(n).includes('producto'))
      || nombres.find(n => !normal(n).includes('instruc') && !normal(n).includes('armad'));
    const hojaA = nombres.find(n => normal(n).includes('armad'));
    const filasP = hojaP ? leerHoja(wb.Sheets[hojaP], {
      codigo: ['codigo'], nombre: ['nombre'], tipo: ['tipo'], cantidad: ['cantidad'], unidad: ['unidad'],
      capacidad: ['capacidad'], costo: ['costo'], precio: ['precio'], minimo: ['minimo'],
    }) : [];
    const filasA = hojaA ? leerHoja(wb.Sheets[hojaA], {
      codigo: ['codigo'], nombre: ['nombre'], esencia: ['referencia'], frasco: ['frasco'],
      pE: ['% esencia', 'esencia %'], pA: ['% alcohol', 'alcohol %'], pF: ['% fijador', 'fijador %'], precio: ['precio'],
    }) : [];
    const P = analizarProductos(filasP);
    const A = analizarArmados(filasA, P.productos);
    planImportacion = { archivo: file.name, productos: P.productos, armados: A.armados };
    mostrarResumenImportacion(P, A);
  } catch (e) {
    console.error(e);
    alert('No se pudo leer el archivo. Usa el formato de la app (botón "Descargar formato").\n\n' + e.message);
  }
}

function mostrarResumenImportacion(P, A) {
  const errores = [...P.errores, ...A.errores];
  const nuevos = P.productos.filter(p => !p.existente && !p.repetido);
  const sumar = P.productos.filter(p => p.existente || p.repetido);
  const total = P.productos.length + A.armados.length;
  modal('Importar desde Excel', `
    <div class="kv">
      <span>Productos nuevos</span><b>${nuevos.length}</b>
      <span>Productos existentes (se suma stock)</span><b>${sumar.length}</b>
      <span>Perfumes armados</span><b>${A.armados.length}</b>
      <span>Filas con error (no se importan)</span><b class="${errores.length ? 'rojo' : ''}">${errores.length}</b>
    </div>
    ${errores.length ? `<div class="aviso error">${errores.slice(0, 15).map(esc).join('<br>')}${errores.length > 15 ? `<br>… y ${errores.length - 15} más` : ''}</div>` : ''}
    ${P.productos.length ? `<h4>Productos</h4><table class="tabla"><tr><th>Producto</th><th class="der">Cantidad</th></tr>
      ${P.productos.slice(0, 60).map(p => `<tr><td>${p.existente ? `<span class="codigo">${esc(p.existente.codigo || '')}</span> ` : '<span class="tag gift">Nuevo</span> '}${esc(p.nombre)}<br><small class="muted">${TIPOS[p.tipo].label}${p.costo ? ' · ' + money(p.costo) : ''}</small></td><td class="der">+${fmtNum(p.cantidad)} ${p.unidad}</td></tr>`).join('')}
    </table>${P.productos.length > 60 ? `<p class="small muted">… y ${P.productos.length - 60} más</p>` : ''}` : ''}
    ${A.armados.length ? `<h4>Perfumes armados</h4><table class="tabla">
      ${A.armados.map(a => `<tr><td>${a.existente ? '' : '<span class="tag gift">Nuevo</span> '}${esc(a.nombre)}<br><small class="muted">${esc(a.esTxt)} · ${esc(a.frTxt)} · ${fmtNum(a.pE)}% esencia / ${fmtNum(a.pA)}% alcohol${a.pF ? ` / ${fmtNum(a.pF)}% fijador` : ''}</small></td><td class="der">${money(a.precio)}</td></tr>`).join('')}
    </table>` : ''}
    ${!total ? '<p class="muted">No encontré filas para importar. Revisa que uses las hojas "Productos" y "Perfumes armados" del formato.</p>' : ''}
    <div class="acciones">
      <button class="btn" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="aplicarImportacion()" ${total ? '' : 'disabled'}>Importar ${total} fila(s)</button>
    </div>`);
}

function aBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function descargarFormato() {
  const nombre = 'Formato_Inventario_Perfumes_Store.xlsx';
  if (NATIVO?.guardarArchivoBase64) {
    const buf = await (await fetch('formato_inventario.xlsx')).arrayBuffer();
    NATIVO.guardarArchivoBase64(nombre, aBase64(buf), XLSX_MIME);
    return;
  }
  const a = document.createElement('a');
  a.href = 'formato_inventario.xlsx';
  a.download = nombre;
  a.click();
}
