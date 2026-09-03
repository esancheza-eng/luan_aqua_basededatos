/* ════════════════════════════════════════
   CONFIG
════════════════════════════════════════ */
/* [NEW] SCRIPT_URL eliminado — los datos ahora vienen de Firestore, no de Google Sheets */

/* ══ FIREBASE — Fase 1: Authentication (login del admin) ══ */
const firebaseConfig = {
  apiKey: "AIzaSyBOPI_zviuktXtH68F8NY4mSnbYcF1tE7s",
  authDomain: "luan-aqua.firebaseapp.com",
  projectId: "luan-aqua",
  storageBucket: "luan-aqua.firebasestorage.app",
  messagingSenderId: "1046111203141",
  appId: "1:1046111203141:web:017cd2d14f1db77c9c582c",
  measurementId: "G-L0YP0548Y6"
};
firebase.initializeApp(firebaseConfig);
/* [SECURITY FIX] Firebase App Check — ver nota igual en index.html. Modo "Monitor" en
   Firebase Console: no bloquea nada todavía, solo registra. */
firebase.appCheck().activate(
  '6Leu0nAtAAAAACV2-G97q5BNW2RZ_lHzEUuIxLfn',
  true
);
const auth = firebase.auth();
const db   = firebase.firestore();
const DOMINIO_LOGIN = '@luanaqua.app';
function _emailDeUsuario(usuario){ return usuario.trim().toLowerCase().replace(/[^a-z0-9._-]/g,'') + DOMINIO_LOGIN; }
/* [SECURITY FIX] Escapa cualquier dato que venga de un usuario (cliente, notas, dirección,
   producto, etc.) antes de insertarlo en innerHTML. Sin esto, un nombre de cliente como
   <img src=x onerror=...> se ejecuta como código en la sesión del admin que lo ve — se debe
   usar SIEMPRE que se interpole un campo de Firestore dentro de una plantilla HTML. */
function escHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
/* [NEW] Instancia secundaria de Firebase — permite crear la cuenta de Secretaria sin
   cerrar la sesión del admin (crear un usuario normalmente inicia sesión con él). */
const _secondaryAppDash = firebase.initializeApp(firebaseConfig, 'secondaryDash');
const _secondaryAuthDash = _secondaryAppDash.auth();

const RUTA_COLORS = {
  'RUTA 1: Jefferson': '#1565c0',
  'RUTA 2: Luis':      '#0a7c6e',
  'RUTA 3: Vicente':   '#e67e22',
  'RUTA 4: Wilson':    '#c0392b',
  'RUTA 5: Lister':    '#7b1fa2',
  'RUTA 6: Asesora':   '#0891b2',
};
const RUTA_INITIALS = {
  'RUTA 1: Jefferson': 'J',
  'RUTA 2: Luis':      'L',
  'RUTA 3: Vicente':   'V',
  'RUTA 4: Wilson':    'W',
  'RUTA 5: Lister':    'Li',
  'RUTA 6: Asesora':   'A',
};

let todosLosDatos = [];
let charts = {};
let autoRefreshInterval = null;
let leafletMap = null;
let leafletLoaded = false;
let mapMarkers = [];
let mapPolylines = [];
let pedidosDetalleActuales = [];

/* [NEW] Editar Pedido — identidad del admin actual (para el historial de cambios) */
let ADMIN_ACTUAL = { uid: null, nombre: 'Admin' };
let ROL_ACTUAL = null; // [NEW] 'admin' | 'secretaria' — controla qué secciones y botones se muestran
/* [NEW] Editar Pedido — catálogo de productos en caché para que el modal abra al instante */
let _productosCache = [];
let _unsubProductosDash = null;
/* [NEW] Editar Pedido — lista de rutas/asesores reales en caché (además del <select> de filtro) */
let _asesoresCache = [];
/* [NEW] Editar Pedido — pedido que se está editando actualmente en el modal */
let editandoPedidoActual = null;

/* ════════════════════════════════════════
   TABS
════════════════════════════════════════ */
/* [NEW] Menú lateral del panel administrativo — cambia entre secciones sin mezclarlas */
function switchSeccionDash(sec){
  document.querySelectorAll('.dash-section').forEach(el => el.classList.toggle('active', el.id === 'seccion-'+sec));
  document.querySelectorAll('.dash-nav-item').forEach(el => el.classList.toggle('active', el.dataset.section === sec));
}
function switchTab(tab) {
  document.getElementById('viewDashboard').classList.toggle('active', tab === 'dashboard');
  document.getElementById('viewRutas').classList.toggle('active', tab === 'rutas');
  document.getElementById('tabDashboard').classList.toggle('active', tab === 'dashboard');
  document.getElementById('tabRutas').classList.toggle('active', tab === 'rutas');
  if (tab === 'rutas') {
    cargarLeaflet(() => {
      if (!leafletMap) initLeafletMap();
      rutasHoy();
      aplicarRutas();
    });
  }
}

/* ════════════════════════════════════════
   LOGIN — [FIX] .toLowerCase() para aceptar Admin/ADMIN/admin
════════════════════════════════════════ */
async function doLogin() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  if (!user || !pass) { document.getElementById('loginError').classList.add('show'); return; }
  try{
    const email = _emailDeUsuario(user);
    const cred = await auth.signInWithEmailAndPassword(email, pass);
    const perfilDoc = await db.collection('usuarios').doc(cred.user.uid).get();
    document.getElementById('loginPass').value = '';
    const perfil = perfilDoc.exists ? perfilDoc.data() : null;
    /* [NEW] Ahora entran dos roles: Admin (acceso total) y Secretaria (solo lectura,
       sin Editar/Eliminar Pedido, sin Inventario/Roles de Pago/Importar Datos/Eliminados) */
    if(!perfil || !(perfil.esAdmin === true || perfil.esSecretaria === true)){
      await auth.signOut();
      document.getElementById('loginError').classList.add('show');
      document.getElementById('loginPass').focus();
      return;
    }
    ROL_ACTUAL = perfil.esAdmin === true ? 'admin' : 'secretaria'; // [NEW]
    ADMIN_ACTUAL = { uid: cred.user.uid, nombre: perfil.nombre || user }; // para el historial de cambios
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('loginError').classList.remove('show');
    iniciar();
  }catch(err){
    console.error(err);
    document.getElementById('loginError').classList.add('show');
    document.getElementById('loginPass').focus();
  }
}

function cerrarSesion() {
  clearInterval(autoRefreshInterval);
  detenerListenersDashboard(); // [NEW]
  detenerListenerAsesoresDash(); // [NEW]
  detenerListenerProductosDash(); // [NEW]
  detenerListenerEliminados(); // [NEW]
  detenerListenerInventario(); // [NEW]
  detenerListenerRolesHistorial(); // [NEW]
  detenerListenerPedidosWeb(); // [NEW]
  auth.signOut(); // la limpieza del overlay ocurre en onAuthStateChanged, más abajo
}

/* [NEW] Firebase Auth mantiene la sesión sola — si el admin o secretaria ya había entrado
   antes (en este navegador), no le vuelve a pedir clave. */
auth.onAuthStateChanged(async (user)=>{
  if(user){
    try{
      const perfilDoc = await db.collection('usuarios').doc(user.uid).get();
      const perfil = perfilDoc.exists ? perfilDoc.data() : null;
      if(perfil && (perfil.esAdmin===true || perfil.esSecretaria===true)){
        ROL_ACTUAL = perfil.esAdmin===true ? 'admin' : 'secretaria'; // [NEW]
        ADMIN_ACTUAL = { uid: user.uid, nombre: perfil.nombre || (ROL_ACTUAL==='admin'?'Admin':'Secretaria') }; // para el historial de cambios
        document.getElementById('loginOverlay').classList.add('hidden');
        iniciar();
      } else {
        await auth.signOut();
      }
    }catch(e){ console.error(e); }
  } else {
    clearInterval(autoRefreshInterval);
    detenerListenersDashboard(); // [NEW]
    detenerListenerAsesoresDash(); // [NEW]
    detenerListenerProductosDash(); // [NEW]
    detenerListenerEliminados(); // [NEW]
    detenerListenerInventario(); // [NEW]
    detenerListenerRolesHistorial(); // [NEW]
    detenerListenerPedidosWeb(); // [NEW]
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
  }
});

/* ════════════════════════════════════════
   INICIAR
════════════════════════════════════════ */
let _unsubAsesoresDash = null;
function _iniciarListenerAsesoresDash(){
  if(_unsubAsesoresDash){_unsubAsesoresDash();_unsubAsesoresDash=null;}
  _unsubAsesoresDash = db.collection('usuarios').where('esAdmin','==',false).onSnapshot(snap => {
    const rutas = snap.docs.map(d => d.data().ruta).filter(Boolean).sort();
    _asesoresCache = rutas; // [NEW] disponible para el <select> de Asesor dentro del modal Editar Pedido
    if (typeof renderReporteAsesores === 'function') renderReporteAsesores(); /* [FIX] antes solo se refrescaba cuando cambiaban los pedidos, no cuando llegaba la lista de asesores — se quedaba en "No hay asesores registrados" si este listener tardaba más en cargar */
    const sel = document.getElementById('filtroAsesor');
    if (!sel) return;
    const valorActual = sel.value;
    sel.innerHTML = '<option value="">Todos</option>' + rutas.map(r => {
      const nombre = r.split(':')[1]?.trim() || r;
      return `<option value="${r}">${nombre}</option>`;
    }).join('');
    if (rutas.includes(valorActual)) sel.value = valorActual;
  }, err => console.error('listener asesores dash:', err));
}
function detenerListenerAsesoresDash(){ if(_unsubAsesoresDash){_unsubAsesoresDash();_unsubAsesoresDash=null;} }

/* [NEW] Editar Pedido — catálogo de productos en vivo, listo antes de abrir el modal
   (misma colección `productos` que ya usa el panel "Gestionar Productos" en index.html) */
function _iniciarListenerProductosDash(){
  if(_unsubProductosDash){_unsubProductosDash();_unsubProductosDash=null;}
  _unsubProductosDash = db.collection('productos').where('activo','==',true).onSnapshot(snap => {
    _productosCache = snap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || '' })).sort((a,b) => a.nombre.localeCompare(b.nombre));
    if(typeof renderInventario==='function') renderInventario(); /* [FIX] antes el <select> de Inventario solo se llenaba cuando cambiaba un movimiento, no cuando llegaba el catálogo de productos — se quedaba vacío si el catálogo cargaba después */
  }, err => console.error('listener productos dash:', err));
}
function detenerListenerProductosDash(){ if(_unsubProductosDash){_unsubProductosDash();_unsubProductosDash=null;} }

/* [NEW] Pedidos Eliminados — respaldo en vivo desde la colección `pedidosEliminados`
   (se llena automáticamente cada vez que el admin usa el botón 🗑 Eliminar). */
let _unsubEliminados=null, _eliminadosRaw=[];
function _iniciarListenerEliminados(){
  if(_unsubEliminados){_unsubEliminados();_unsubEliminados=null;}
  _unsubEliminados = db.collection('pedidosEliminados').onSnapshot(snap => {
    _eliminadosRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a,b) => (b.eliminadoEn?.toMillis?.()||0) - (a.eliminadoEn?.toMillis?.()||0));
    renderTablaEliminados();
  }, err => console.error('listener eliminados:', err));
}
function detenerListenerEliminados(){ if(_unsubEliminados){_unsubEliminados();_unsubEliminados=null;} }

/* [NEW] Inventario — entradas y salidas, en vivo */
let _unsubInventario=null, _movimientosInvRaw=[];
function _iniciarListenerInventario(){
  if(_unsubInventario){_unsubInventario();_unsubInventario=null;}
  _unsubInventario = db.collection('inventarioMovimientos').onSnapshot(snap => {
    _movimientosInvRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a,b) => (b.creadoEn?.toMillis?.()||0) - (a.creadoEn?.toMillis?.()||0));
    renderInventario();
  }, err => console.error('listener inventario:', err));
}
function detenerListenerInventario(){ if(_unsubInventario){_unsubInventario();_unsubInventario=null;} }

/* [NEW] Roles de Pago — historial de roles ya generados, en vivo */
let _unsubRolesHist=null, _rolesConfig={};
function _iniciarListenerRolesHistorial(){
  if(_unsubRolesHist){_unsubRolesHist();_unsubRolesHist=null;}
  _unsubRolesHist = db.collection('rolesPago').onSnapshot(snap => {
    const roles = snap.docs.map(d => d.data()).sort((a,b) => (b.creadoEn?.toMillis?.()||0) - (a.creadoEn?.toMillis?.()||0));
    const tbody = document.getElementById('tablaRolesHistorial');
    if (!tbody) return;
    tbody.innerHTML = roles.length ? roles.slice(0,100).map(r => `<tr>
        <td style="font-size:12px">${r.periodoDesde||'-'} → ${r.periodoHasta||'-'}</td>
        <td style="font-weight:600">${r.asesorNombre||'-'}</td>
        <td style="text-align:right;font-weight:700;color:var(--teal)">$${(r.totalPagado||0).toFixed(2)}</td>
        <td style="font-size:12px">${r.generadoPor||'-'}</td>
        <td style="font-size:12px;color:var(--muted)">${r.fechaGeneracion||'-'}</td>
      </tr>`).join('') : '<tr><td colspan="5"><div class="empty-state"><div class="icon">📋</div>Sin roles generados aún</div></td></tr>';
  }, err => console.error('listener roles:', err));
}
function detenerListenerRolesHistorial(){ if(_unsubRolesHist){_unsubRolesHist();_unsubRolesHist=null;} }

function iniciar() {
  const hoy = fechaHoy();
  document.getElementById('filtroFecha').value = hoy;
  iniciarListenersDashboard(); // [NEW] tiempo real — reemplaza el polling cada 60s
  _iniciarListenerAsesoresDash(); // [NEW] filtro de asesor real, en vivo
  _iniciarListenerProductosDash(); // [NEW] catálogo de productos para el modal Editar Pedido
  if (ROL_ACTUAL === 'admin') { // [NEW] Secretaria no tiene permiso de lectura en estas colecciones — ni falta que le hace, sus pestañas están ocultas
    _iniciarListenerEliminados(); // [NEW] respaldo de pedidos eliminados
    _iniciarListenerInventario(); // [NEW] entradas y salidas
    _iniciarListenerRolesHistorial(); // [NEW] historial de roles de pago
    _iniciarListenerPedidosWeb(); // [NEW] cola de pedidos de la página web
    poblarSelectEliminarSecretaria(); // [NEW]
  }
  document.getElementById('invFecha').value = hoy; // [NEW]
  document.getElementById('rolesDesde').value = hoy; // [NEW]
  document.getElementById('rolesHasta').value = hoy; // [NEW]
  aplicarRestriccionesRol(); // [NEW]
}
/* [NEW] Oculta las secciones y botones que son solo para Admin cuando entra Secretaria */
function aplicarRestriccionesRol(){
  const esSecretaria = ROL_ACTUAL === 'secretaria';
  ['navEliminados','navInventario','navRoles','navImportar','navUsuarios','navPedidosWeb'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = esSecretaria ? 'none' : '';
  });
  if (esSecretaria) {
    // Si por alguna razón queda una de esas secciones activa, regresa a Resumen General
    const seccionActivaOculta = ['eliminados','inventario','roles','importar','usuarios','pedidosweb'].some(s => {
      const sec = document.getElementById('seccion-'+s);
      return sec && sec.classList.contains('active');
    });
    if (seccionActivaOculta) switchSeccionDash('resumen');
  }
}
function fechaHoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* [FIX] Convierte "7:59:52 p. m." / "8:00 a. m." / "19:59:52" a minutos desde medianoche (0-1439).
   Devuelve NaN si el texto no tiene un formato de hora reconocible. */
function horaAMinutos(str) {
  if (!str) return NaN;
  const s = String(str).trim();
  const m12 = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*\.?\s*m\.?/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = parseInt(m12[2], 10);
    const ampm = m12[4].toLowerCase();
    if (ampm === 'p' && h !== 12) h += 12;
    if (ampm === 'a' && h === 12) h = 0;
    if (isNaN(h) || isNaN(min)) return NaN;
    return h * 60 + min;
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (!isNaN(h) && !isNaN(min)) return h * 60 + min;
  }
  return NaN;
}

/* ════════════════════════════════════════
   CARGAR DATOS
════════════════════════════════════════ */
/* ════════════════════════════════════════
   [NEW] FIRESTORE — Fase 2: datos en tiempo real
   Construye filas con el MISMO formato que antes venía de Google Sheets
   (FECHA, ASESOR / RUTA, CLIENTE, PRODUCTO, TOTAL PEDIDO ($), etc.) para
   que el resto del dashboard (tablas, gráficos, Cierre del Día, exportar
   PDF) siga funcionando sin tener que reescribirlo.
════════════════════════════════════════ */
let _pedidosRaw = [], _pagosRaw = [], _gastosRaw = [];
let _unsubPedidosAll = null, _unsubPagosAll = null, _unsubGastosAll = null;

function _horaDeTs(ts) {
  try { const ms = ts?.toMillis ? ts.toMillis() : Date.now(); return new Date(ms).toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
  catch { return ''; }
}
function _filaProducto(p, prod, esPrimera, esRegalo) {
  return {
    'FECHA': p.fecha || '', 'ASESOR / RUTA': p.empleado || '', 'CLIENTE': p.cliente || '',
    'TELÉFONO': p.telefono || '', 'DIRECCIÓN': p.direccion || '',
    'PRODUCTO': esRegalo ? `🎁 REGALO: ${prod.nombre || ''}` : (prod.nombre || ''),
    'CANTIDAD': prod.cantidad != null ? prod.cantidad : '',
    'PRECIO UNIT.': esRegalo ? 0 : (prod.precio != null ? prod.precio : ''),
    'SUBTOTAL': esRegalo ? 0 : (prod.subtotal != null ? prod.subtotal : ''),
    'TOTAL PEDIDO ($)': esPrimera ? (parseFloat(p.total) || 0) : '',
    'FORMA DE PAGO': p.formapago || '', 'LINK GPS': (p.gps && p.gps.url) ? p.gps.url : '', 'NOTAS': p.notas || '',
    'LATITUD': (p.gps && p.gps.lat != null) ? p.gps.lat : '', 'LONGITUD': (p.gps && p.gps.lng != null) ? p.gps.lng : '',
    'PRECISIÓN GPS': (p.gps && p.gps.acc != null) ? `±${p.gps.acc}m` : '',
    'HORA REGISTRO': _horaDeTs(p.creadoEn),
    '_pedidoId': p._id || '' /* [NEW] id real del documento en Firestore — necesario para poder editarlo */
  };
}
function _expandirPedido(p) {
  const filas = []; let primera = true;
  (p.productos || []).forEach(prod => {
    filas.push(_filaProducto(p, prod, primera, false));
    primera = false;
    (prod.regalias || []).forEach(reg => { filas.push(_filaProducto(p, reg, false, true)); });
  });
  return filas;
}
function _recalcularTodosLosDatos() {
  let filas = [];
  _pedidosRaw.forEach(p => { filas = filas.concat(_expandirPedido(p)); });
  _pagosRaw.forEach(pg => filas.push({
    'FECHA': pg.fecha || '', 'ASESOR / RUTA': pg.empleado || '', 'CLIENTE': pg.cliente || '',
    'TELÉFONO': '', 'DIRECCIÓN': '', 'PRODUCTO': '', 'CANTIDAD': '', 'PRECIO UNIT.': '', 'SUBTOTAL': '',
    'TOTAL PEDIDO ($)': parseFloat(pg.monto) || 0, 'FORMA DE PAGO': pg.forma || '', 'LINK GPS': '', 'NOTAS': pg.notas || '',
    '_pagoId': pg._id || '' /* [NEW] */
  }));
  _gastosRaw.forEach(g => filas.push({
    'FECHA': g.fecha || '', 'ASESOR / RUTA': g.empleado || '', 'CLIENTE': '',
    'TELÉFONO': '', 'DIRECCIÓN': '', 'PRODUCTO': '', 'CANTIDAD': '', 'PRECIO UNIT.': '', 'SUBTOTAL': '',
    'TOTAL PEDIDO ($)': -(parseFloat(g.monto) || 0), 'FORMA DE PAGO': '', 'LINK GPS': '', 'NOTAS': g.desc || g.categoria || '',
    '_gastoId': g._id || '' /* [NEW] */
  }));
  todosLosDatos = filas;
  renderDashboard();
  document.getElementById('lastUpdate').textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit' });
}
function iniciarListenersDashboard() {
  if (_unsubPedidosAll) _unsubPedidosAll();
  if (_unsubPagosAll) _unsubPagosAll();
  if (_unsubGastosAll) _unsubGastosAll();
  document.getElementById('kpiGrid').innerHTML = '<div class="loading"><div class="spinner"></div><span>Cargando datos...</span></div>';
  _unsubPedidosAll = db.collection('pedidos').onSnapshot(snap => {
    /* [FIX] Se quitó el orderBy('creadoEn','desc') del lado de Firestore — ese ordenamiento
       EXCLUÍA por completo cualquier pedido que aún no tuviera confirmado su creadoEn en el
       servidor (típico de pedidos guardados offline mientras terminan de sincronizar),
       haciendo que desaparecieran de TODO el dashboard, no solo de "Detalle de Pedidos".
       Ahora el orden "más reciente primero" se hace aquí, del lado del navegador, sobre TODOS
       los documentos recibidos — nadie se excluye, solo se ordenan. */
    _pedidosRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a,b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
    _recalcularTodosLosDatos();
  }, err => { console.error('listener pedidos:', err); document.getElementById('kpiGrid').innerHTML = '<div class="loading"><span>⚠️ Error al cargar datos: '+err.message+'</span></div>'; }); /* [FIX] _id agregado — antes no se guardaba el id del documento, y sin él no era posible editar un pedido puntual */
  _unsubPagosAll   = db.collection('pagos').onSnapshot(snap => { _pagosRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() })); _recalcularTodosLosDatos(); }, err => console.error('listener pagos:', err)); /* [NEW] _id agregado para poder editar/eliminar */
  _unsubGastosAll  = db.collection('gastos').onSnapshot(snap => { _gastosRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() })); _recalcularTodosLosDatos(); }, err => console.error('listener gastos:', err)); /* [NEW] _id agregado para poder editar/eliminar */
}
function detenerListenersDashboard() {
  if (_unsubPedidosAll) { _unsubPedidosAll(); _unsubPedidosAll = null; }
  if (_unsubPagosAll)   { _unsubPagosAll();   _unsubPagosAll   = null; }
  if (_unsubGastosAll)  { _unsubGastosAll();  _unsubGastosAll  = null; }
}
/* Botón "Actualizar" — con listeners en tiempo real los datos ya están al día,
   así que solo forzamos un re-render inmediato con lo último recibido. */
async function cargarDatos(mostrarSpinner = true) {
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('spin-icon');
  _recalcularTodosLosDatos();
  setTimeout(() => { if (icon) icon.classList.remove('spin-icon'); }, 500);
}

/* ════════════════════════════════════════
   FILTROS DASHBOARD
════════════════════════════════════════ */
function filtrarHoy() { document.getElementById('filtroFecha').value = fechaHoy(); renderDashboard(); }
function limpiarFiltro() { document.getElementById('filtroFecha').value = ''; if (document.getElementById('filtroAsesor')) document.getElementById('filtroAsesor').value = ''; renderDashboard(); }
function getDatosFiltrados() {
  const filtro = document.getElementById('filtroFecha').value;
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  let datos = todosLosDatos;
  if (filtro) datos = datos.filter(r => { const fecha = r['FECHA'] || r['fecha'] || ''; return String(fecha).includes(filtro); });
  if (asesorSel) datos = datos.filter(r => (r['ASESOR / RUTA']||'') === asesorSel);
  return datos;
}
/* [NEW] Igual que getDatosFiltrados() pero SIN el filtro de asesor — para que "Reporte
   por Asesor" siempre pueda mostrar todas las tarjetas, sin importar qué asesor esté
   seleccionado arriba en el filtro general del dashboard. */
function getDatosSoloFecha() {
  const filtro = document.getElementById('filtroFecha').value;
  let datos = todosLosDatos;
  if (filtro) datos = datos.filter(r => { const fecha = r['FECHA'] || r['fecha'] || ''; return String(fecha).includes(filtro); });
  return datos;
}

/* ════════════════════════════════════════
   RENDER DASHBOARD
════════════════════════════════════════ */
function renderDashboard() {
  const datos = getDatosFiltrados();
  const pedidos = datos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== '');
  const pagos   = datos.filter(r => !r['PRODUCTO'] && r['TOTAL PEDIDO ($)'] > 0 && String(r['TOTAL PEDIDO ($)']).indexOf('-') === -1);
  const gastos  = datos.filter(r => String(r['TOTAL PEDIDO ($)']).indexOf('-') !== -1);
  const pedidosConTotal = pedidos.filter(r => r['TOTAL PEDIDO ($)'] && parseFloat(r['TOTAL PEDIDO ($)']) > 0);
  const totalReal   = pedidosConTotal.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalPagos  = pagos.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalGastos = gastos.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const clientesUnicos = new Set(pedidos.map(r => r['CLIENTE'])).size;
  const pedidosUnicos  = new Set(pedidos.map(r => `${r['CLIENTE']}-${r['FECHA']}-${r['ASESOR / RUTA']}`)).size;
  const ventasPorAsesor = {};
  pedidosConTotal.forEach(r => { const a = r['ASESOR / RUTA'] || 'Sin asignar'; ventasPorAsesor[a] = (ventasPorAsesor[a]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const asesorTop = Object.entries(ventasPorAsesor).sort((a,b) => b[1]-a[1])[0];
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-card teal"><div class="kpi-icon">💰</div><div class="kpi-label">Total ventas</div><div class="kpi-value">$${totalReal.toFixed(2)}</div><div class="kpi-sub">${pedidosUnicos} pedido(s)</div></div>
    <div class="kpi-card blue"><div class="kpi-icon">💳</div><div class="kpi-label">Total cobrado</div><div class="kpi-value">$${totalPagos.toFixed(2)}</div><div class="kpi-sub">${pagos.length} pago(s)</div></div>
    <div class="kpi-card red"><div class="kpi-icon">📉</div><div class="kpi-label">Total gastos</div><div class="kpi-value">$${totalGastos.toFixed(2)}</div><div class="kpi-sub">${gastos.length} gasto(s)</div></div>
    <div class="kpi-card orange"><div class="kpi-icon">👥</div><div class="kpi-label">Clientes atendidos</div><div class="kpi-value">${clientesUnicos}</div><div class="kpi-sub">${pedidosUnicos} pedido(s)</div></div>
    <div class="kpi-card navy"><div class="kpi-icon">🏆</div><div class="kpi-label">Asesor top</div><div class="kpi-value" style="font-size:1rem">${asesorTop ? asesorTop[0].split(':')[1]?.trim()||asesorTop[0] : '—'}</div><div class="kpi-sub">${asesorTop ? '$'+asesorTop[1].toFixed(2) : 'Sin datos'}</div></div>
    <div class="kpi-card accent"><div class="kpi-icon">📦</div><div class="kpi-label">Líneas de producto</div><div class="kpi-value">${pedidos.length}</div><div class="kpi-sub">unidades registradas</div></div>
    <div class="kpi-card navy"><div class="kpi-icon">🧮</div><div class="kpi-label">Total en caja</div><div class="kpi-value" style="color:${(totalPagos-totalGastos)>=0?'#0a7c6e':'#c0392b'}">$${(totalPagos-totalGastos).toFixed(2)}</div><div class="kpi-sub">Ingresos − Egresos</div></div>
  `;
  renderCharts(pedidos, pedidosConTotal);
  pedidosDetalleActuales = pedidos;
  renderTabla(pedidos);
  renderResumenPorCliente(pedidos); // [NEW]
  poblarClienteSelect(pedidos);
  renderPagosGastosDetalle(pagos, gastos); // [NEW]
  document.getElementById('chartsGrid').style.display = 'grid';
  document.getElementById('tableCard').style.display = 'block';
  document.getElementById('clienteCard').style.display = 'block';
  document.getElementById('pagosGastosCard').style.display = 'block'; // [NEW]
  renderReporteAsesores(); // [NEW]
}

/* ════════════════════════════════════════
   [NEW] DETALLE DE PAGOS Y GASTOS
════════════════════════════════════════ */
let pagosDetalleActuales = [], gastosDetalleActuales = []; // [NEW] para exportar a PDF

function renderPagosGastosDetalle(pagos, gastos) {
  pagosDetalleActuales = pagos; gastosDetalleActuales = gastos; // [NEW]
  const totalPagos  = pagos.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalGastos = gastos.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const neto = totalPagos - totalGastos;

  // [NEW] Desglose por forma de pago (Efectivo / Transferencia / Cheque / etc.)
  const porForma = {};
  pagos.forEach(r => { const f = r['FORMA DE PAGO'] || 'Sin especificar'; porForma[f] = (porForma[f]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const iconoForma = { 'Efectivo':'💵','Transferencia':'🏦','Cheque':'📝','Contado':'💵','Crédito':'📋' };
  const tagsForma = Object.entries(porForma).sort(([,a],[,b]) => b-a).map(([f,v]) => `
    <span style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1.5px solid var(--border);border-radius:100px;padding:5px 14px;font-size:12px;font-weight:700;color:var(--navy)">${iconoForma[f]||'💳'} ${f}<span style="color:var(--blue);margin-left:2px">$${v.toFixed(2)}</span></span>`).join('');
  document.getElementById('resumenFormasPago').innerHTML = pagos.length
    ? `<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Desglose por forma de pago</div><div style="display:flex;flex-wrap:wrap;gap:8px">${tagsForma}</div>`
    : '';

  document.getElementById('resumenPgGrid').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <div style="flex:1;min-width:170px;background:var(--teal-light);border:1.5px solid var(--success-border,#4ec9a0);border-radius:var(--radius);padding:14px 16px">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--teal-dark)">🟢 Ingresos (pagos cobrados)</div>
        <div style="font-family:'DM Serif Display',serif;font-size:1.6rem;color:var(--teal-dark)">$${totalPagos.toFixed(2)}</div>
        <div style="font-size:11px;color:var(--muted)">${pagos.length} pago(s)</div>
      </div>
      <div style="flex:1;min-width:170px;background:#fdecea;border:1.5px solid #e57373;border-radius:var(--radius);padding:14px 16px">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--red)">🔴 Egresos (gastos)</div>
        <div style="font-family:'DM Serif Display',serif;font-size:1.6rem;color:var(--red)">$${totalGastos.toFixed(2)}</div>
        <div style="font-size:11px;color:var(--muted)">${gastos.length} gasto(s)</div>
      </div>
    </div>
    <div style="background:var(--navy);border-radius:var(--radius);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <span style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.6)">🧮 Total en caja (Ingresos − Egresos)</span>
      <span style="font-family:'DM Serif Display',serif;font-size:1.9rem;color:${neto>=0?'#4ec9a0':'#f48fb1'}">$${neto.toFixed(2)}</span>
    </div>
    </div>`;

  const tbodyPagos = document.getElementById('tablaPagosDetalle');
  if (!pagos.length) {
    tbodyPagos.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon">💳</div>No hay pagos en este período</div></td></tr>';
  } else {
    const filas = pagos.map(r => {
      const monto = parseFloat(r['TOTAL PEDIDO ($)'])||0;
      const accionesPago = (r['_pagoId'] && ROL_ACTUAL === 'admin') ? `<button class="btn-editar-fila" onclick="abrirEditarPago('${r['_pagoId']}')" title="Editar este pago">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarPagoDash('${r['_pagoId']}')" title="Eliminar este pago">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>'; /* [NEW] Secretaria no ve Editar/Eliminar */
      return `<tr>
        <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
        <td style="font-size:12px">${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
        <td><span class="badge badge-blue">${r['FORMA DE PAGO']||'-'}</span></td>
        <td style="font-size:11px;color:var(--muted);white-space:nowrap">${limpiarFecha(r['FECHA'])}</td>
        <td style="text-align:right;font-weight:700;color:var(--blue)">$${monto.toFixed(2)}</td>
        <td>${accionesPago}</td>
      </tr>`;
    }).join('');
    tbodyPagos.innerHTML = filas + `<tr style="background:#e8f0fd"><td colspan="4" style="text-align:right;font-weight:800;color:var(--blue)">SUBTOTAL PAGOS</td><td style="text-align:right;font-weight:800;color:var(--blue)">$${totalPagos.toFixed(2)}</td><td></td></tr>`;
  }

  const tbodyGastos = document.getElementById('tablaGastosDetalle');
  if (!gastos.length) {
    tbodyGastos.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="icon">📉</div>No hay gastos en este período</div></td></tr>';
  } else {
    const filas = gastos.map(r => {
      const monto = Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0);
      const desc = r['NOTAS'] || r['CLIENTE'] || r['DIRECCIÓN'] || '-'; // [NOTA] ver aviso más abajo sobre esta columna
      const accionesGasto = (r['_gastoId'] && ROL_ACTUAL === 'admin') ? `<button class="btn-editar-fila" onclick="abrirEditarGasto('${r['_gastoId']}')" title="Editar este gasto">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarGastoDash('${r['_gastoId']}')" title="Eliminar este gasto">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>'; /* [NEW] Secretaria no ve Editar/Eliminar */
      return `<tr>
        <td style="font-weight:600">${escHTML(desc)}</td>
        <td style="font-size:12px">${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
        <td style="font-size:11px;color:var(--muted);white-space:nowrap">${limpiarFecha(r['FECHA'])}</td>
        <td style="text-align:right;font-weight:700;color:var(--red)">$${monto.toFixed(2)}</td>
        <td>${accionesGasto}</td>
      </tr>`;
    }).join('');
    tbodyGastos.innerHTML = filas + `<tr style="background:#fdecea"><td colspan="3" style="text-align:right;font-weight:800;color:var(--red)">SUBTOTAL GASTOS</td><td style="text-align:right;font-weight:800;color:var(--red)">$${totalGastos.toFixed(2)}</td><td></td></tr>`;
  }
}

/* ════════════════════════════════════════
   CHARTS
════════════════════════════════════════ */
function renderCharts(pedidos, pedidosConTotal) {
  const ventasPorRuta = {};
  pedidosConTotal.forEach(r => { const ruta = (r['ASESOR / RUTA']||'Sin asignar').split(':')[1]?.trim() || r['ASESOR / RUTA']; ventasPorRuta[ruta] = (ventasPorRuta[ruta]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  if (charts.rutas) charts.rutas.destroy();
  charts.rutas = new Chart(document.getElementById('chartRutas').getContext('2d'), {
    type: 'bar',
    data: { labels: Object.keys(ventasPorRuta), datasets: [{ label:'Ventas ($)', data: Object.values(ventasPorRuta), backgroundColor:['#0a7c6e','#1565c0','#e67e22','#c0392b','#4ec9a0'], borderRadius:6 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true,ticks:{callback:v=>'$'+v,font:{size:11}},grid:{color:'rgba(0,0,0,0.05)'}}, x:{ticks:{font:{size:11}},grid:{display:false}} } }
  });
  const cantPorProducto = {};
  pedidos.forEach(r => { const p=r['PRODUCTO']||''; if(p) cantPorProducto[p]=(cantPorProducto[p]||0)+(parseFloat(r['CANTIDAD'])||0); });
  const prodSorted = Object.entries(cantPorProducto).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if (charts.productos) charts.productos.destroy();
  charts.productos = new Chart(document.getElementById('chartProductos').getContext('2d'), {
    type:'doughnut',
    data:{ labels:prodSorted.map(([k])=>k.length>15?k.substring(0,15)+'…':k), datasets:[{ data:prodSorted.map(([,v])=>v), backgroundColor:['#0a7c6e','#1565c0','#e67e22','#c0392b','#4ec9a0','#1a3a5c'], borderWidth:2, borderColor:'#fff' }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:'right',labels:{font:{size:10},boxWidth:12,padding:8}} } }
  });
  const ventasPorHora = {};
  for(let h=7;h<=20;h++) ventasPorHora[h]=0;
  pedidosConTotal.forEach(r => {
    const minutos = horaAMinutos(r['HORA REGISTRO']);
    if(!isNaN(minutos)){ const h=Math.floor(minutos/60); if(h>=7&&h<=20) ventasPorHora[h]=(ventasPorHora[h]||0)+(parseFloat(r['TOTAL PEDIDO ($)'])||0); }
  });
  if (charts.horas) charts.horas.destroy();
  charts.horas = new Chart(document.getElementById('chartHoras').getContext('2d'), {
    type:'line',
    data:{ labels:Object.keys(ventasPorHora).map(h=>h+':00'), datasets:[{ label:'Ventas ($)', data:Object.values(ventasPorHora), borderColor:'#0a7c6e', backgroundColor:'rgba(10,124,110,0.08)', borderWidth:2.5, pointBackgroundColor:'#0a7c6e', pointRadius:4, tension:0.4, fill:true }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true,ticks:{callback:v=>'$'+v,font:{size:11}},grid:{color:'rgba(0,0,0,0.05)'}}, x:{ticks:{font:{size:11}},grid:{display:false}} } }
  });
}

function renderGPS(pedidos) {
  const container = document.getElementById('mapPoints');
  const conGPS = pedidos.filter(r => r['LINK GPS'] && r['LINK GPS'] !== '');
  if (!conGPS.length) { container.innerHTML = '<div class="map-empty">📍 No hay ubicaciones GPS registradas en este período.</div>'; return; }
  container.innerHTML = conGPS.map(r => `
    <a class="map-point" href="${r['LINK GPS']}" target="_blank">
      <div class="map-dot"></div>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--navy)">${escHTML(r['CLIENTE']||'-')}</div>
        <div style="font-size:10px;color:var(--muted)">${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||''} · ${r['FECHA']||''}</div>
      </div>
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="margin-left:auto;flex-shrink:0"><path d="M4 12L12 4M12 4H7M12 4v5" stroke="var(--teal)" stroke-width="1.5" stroke-linecap="round"/></svg>
    </a>
  `).join('');
}

function renderTabla(pedidos) {
  const tbody = document.getElementById('tablaPedidos');
  if (!pedidos.length) { tbody.innerHTML = '<tr><td colspan="12"><div class="empty-state"><div class="icon">📋</div>No hay pedidos en este período</div></td></tr>'; return; }
  tbody.innerHTML = pedidos.slice(0,100).map(r => {
    const gps   = r['LINK GPS'] ? `<a href="${r['LINK GPS']}" target="_blank" style="color:var(--teal);font-weight:700;font-size:11px">📍 Ver</a>` : '<span style="color:var(--muted);font-size:11px">—</span>';
    const total = r['TOTAL PEDIDO ($)'] ? `<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>` : '';
    const pago  = r['FORMA DE PAGO'] ? `<span class="badge badge-teal">${r['FORMA DE PAGO']}</span>` : '';
    /* [NEW] Botón Editar — solo funciona si la fila trae el id real del pedido en Firestore
       (las filas de pagos/gastos no lo traen, pero renderTabla solo recibe pedidos con producto) */
    const accion = (r['_pedidoId'] && ROL_ACTUAL === 'admin') ? `<button class="btn-editar-fila" onclick="abrirEditarPedido('${r['_pedidoId']}')" title="Editar este pedido">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarPedidoCompleto('${r['_pedidoId']}')" title="Eliminar este pedido permanentemente">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>'; /* [NEW] Secretaria no ve Editar/Eliminar */
    return `<tr>
      <td style="white-space:nowrap;font-size:12px">${limpiarFecha(r['FECHA'])}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--muted)">${escHTML(r['HORA REGISTRO']||'-')}</td>
      <td style="font-size:12px">${escHTML((r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-')}</td>
      <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
      <td style="font-size:12px;color:var(--muted)">${escHTML(r['TELÉFONO']||'-')}</td>
      <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:center;font-size:12px">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right;font-size:12px;color:var(--muted)">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
      <td style="text-align:right">${total}</td>
      <td>${pago}</td>
      <td>${gps}</td>
      <td>${accion}</td>
    </tr>`;
  }).join('');
}

/* [NEW] Resumen por Cliente — agrupa el detalle de pedidos por cliente,
   con Producto / Cant. / Subtotal / Total / Pago debajo de cada uno. */
function renderResumenPorCliente(pedidos) {
  const card = document.getElementById('resumenClientesCard');
  const cont = document.getElementById('resumenClientesContenido');
  if (!pedidos.length) { card.style.display = 'none'; cont.innerHTML=''; return; }
  const porCliente = {};
  pedidos.forEach(r => {
    const cliente = r['CLIENTE'] || 'Sin nombre';
    if (!porCliente[cliente]) porCliente[cliente] = { items: [], formaPago: '' };
    porCliente[cliente].items.push(r);
    if (r['FORMA DE PAGO']) porCliente[cliente].formaPago = r['FORMA DE PAGO'];
  });
  const clientesOrdenados = Object.entries(porCliente).sort(([a],[b]) => a.localeCompare(b));
  const html = clientesOrdenados.map(([cliente, c]) => {
    const totalesPedido = c.items.map(r => parseFloat(r['TOTAL PEDIDO ($)']||0)).filter(v => v > 0);
    const totalCliente = totalesPedido.length ? totalesPedido.reduce((s,v) => s+v, 0) : c.items.reduce((s,r) => s+(parseFloat(r['SUBTOTAL']||0)), 0);
    const cantidadTotal = c.items.reduce((s,r) => s+(parseFloat(r['CANTIDAD'])||0), 0); // [NEW]
    const porForma = {}; // [NEW] desglose de formas de pago del cliente
    c.items.forEach(r => { const f = r['FORMA DE PAGO'] || 'Sin especificar'; porForma[f] = (porForma[f]||0) + (parseFloat(r['SUBTOTAL'])||0); });
    const tagsPagoCliente = Object.entries(porForma).sort(([,a],[,b]) => b-a).map(([f,v]) => `<span class="badge badge-teal" style="margin-right:4px">${f}: $${v.toFixed(2)}</span>`).join('');
    const filas = c.items.map(r => `
      <tr>
        <td>${escHTML(r['PRODUCTO']||'-')}</td>
        <td style="text-align:center">${r['CANTIDAD']||'-'}</td>
        <td style="text-align:right">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
        <td style="text-align:right">${r['TOTAL PEDIDO ($)']?'$'+parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2):'—'}</td>
        <td style="text-align:left"><span class="badge badge-teal">${r['FORMA DE PAGO']||'-'}</span></td>
      </tr>`).join('');
    return `
      <div class="cierre-cliente-block" style="margin:0 0 12px">
        <div class="cierre-cliente-header">
          <span class="cierre-cliente-nombre">👤 ${escHTML(cliente)}</span>
          <span class="cierre-cliente-meta">💳 ${c.formaPago||'Sin especificar'}</span>
          <span class="cierre-cliente-total">$${totalCliente.toFixed(2)}</span>
        </div>
        <div style="display:flex;gap:24px;flex-wrap:wrap;padding:10px 14px;background:var(--surface2);border-bottom:1px solid var(--border)">
          <div><div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)">Cantidad total</div><div style="font-weight:800;color:var(--navy);font-size:14px">${cantidadTotal%1===0?parseInt(cantidadTotal):cantidadTotal.toFixed(1)} unidad(es)</div></div>
          <div><div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)">Total</div><div style="font-weight:800;color:var(--teal);font-size:14px">$${totalCliente.toFixed(2)}</div></div>
          <div><div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)">Formas de pago</div><div style="margin-top:2px">${tagsPagoCliente}</div></div>
        </div>
        <table class="cierre-cliente-table">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Subtotal</th><th>Total</th><th>Pago</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
  }).join('');
  cont.innerHTML = html;
  card.style.display = 'block';
}

/* ════════════════════════════════════════
   NOTAS VENTAS
════════════════════════════════════════ */
let datosNotasFiltrados = [];
function aplicarNotasFiltros() {
  const fecha  = document.getElementById('notasFecha').value;
  const asesor = document.getElementById('notasAsesor').value;
  const pago   = document.getElementById('notasPago').value;
  let datos = todosLosDatos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== '');
  if (fecha)  datos = datos.filter(r => { const f=String(r['FECHA']||''); return f.startsWith(fecha)||f.includes(fecha.split('-').reverse().join('/')); });
  if (asesor) datos = datos.filter(r => (r['ASESOR / RUTA']||'') === asesor);
  if (pago)   datos = datos.filter(r => (r['FORMA DE PAGO']||'') === pago);
  datosNotasFiltrados = datos;
  const pedidosUnicos = new Set(datos.map(r=>`${r['CLIENTE']}-${r['FECHA']}-${r['ASESOR / RUTA']}`)).size;
  const totalVentas   = datos.filter(r=>r['TOTAL PEDIDO ($)']&&parseFloat(r['TOTAL PEDIDO ($)'])>0).reduce((s,r)=>s+(parseFloat(r['TOTAL PEDIDO ($)'])||0),0);
  const totalUnidades = datos.reduce((s,r)=>s+(parseFloat(r['CANTIDAD'])||0),0);
  document.getElementById('notasCount').textContent = datos.length;
  document.getElementById('notasTotalPedidos').textContent = pedidosUnicos;
  document.getElementById('notasTotalVentas').textContent = '$'+totalVentas.toFixed(2);
  document.getElementById('notasTotalUnidades').textContent = totalUnidades;
  const tbody = document.getElementById('tablaNotas');
  const card  = document.getElementById('notasCard');
  if (!datos.length) { tbody.innerHTML=`<tr><td colspan="9"><div class="empty-state"><div class="icon">📋</div>No hay resultados con estos filtros</div></td></tr>`; card.style.display='block'; return; }
  tbody.innerHTML = datos.map(r => {
    const total = r['TOTAL PEDIDO ($)'] ? `<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>` : '';
    return `<tr>
      <td style="font-size:12px;white-space:nowrap">${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
      <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
      <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:right;font-size:12px">$${parseFloat(r['PRECIO UNIT.']||0).toFixed(2)}</td>
      <td style="text-align:center;font-weight:700">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right;font-size:12px;color:var(--muted)">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
      <td style="text-align:right">${total}</td>
      <td><span class="badge badge-teal">${r['FORMA DE PAGO']||'-'}</span></td>
      <td style="font-size:11px;color:var(--muted);white-space:nowrap">${limpiarFecha(r['FECHA'])}</td>
    </tr>`;
  }).join('');
  card.style.display = 'block';
  const pedidosConTotal = datos.filter(r=>r['TOTAL PEDIDO ($)']&&parseFloat(r['TOTAL PEDIDO ($)'])>0);
  const totalReal = pedidosConTotal.reduce((s,r)=>s+(parseFloat(r['TOTAL PEDIDO ($)'])||0),0);
  const clientesUnicos2 = new Set(datos.map(r=>r['CLIENTE'])).size;
  const pedidosUnicos2  = new Set(datos.map(r=>`${r['CLIENTE']}-${r['FECHA']}-${r['ASESOR / RUTA']}`)).size;
  const vpa = {};
  pedidosConTotal.forEach(r=>{ const a=r['ASESOR / RUTA']||'Sin asignar'; vpa[a]=(vpa[a]||0)+(parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const at = Object.entries(vpa).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-card teal"><div class="kpi-icon">💰</div><div class="kpi-label">Total ventas</div><div class="kpi-value">$${totalReal.toFixed(2)}</div><div class="kpi-sub">${pedidosUnicos2} pedido(s)</div></div>
    <div class="kpi-card blue"><div class="kpi-icon">💳</div><div class="kpi-label">Total cobrado</div><div class="kpi-value">$0.00</div><div class="kpi-sub">filtrado</div></div>
    <div class="kpi-card red"><div class="kpi-icon">📉</div><div class="kpi-label">Total gastos</div><div class="kpi-value">$0.00</div><div class="kpi-sub">filtrado</div></div>
    <div class="kpi-card orange"><div class="kpi-icon">👥</div><div class="kpi-label">Clientes atendidos</div><div class="kpi-value">${clientesUnicos2}</div><div class="kpi-sub">${pedidosUnicos2} pedido(s)</div></div>
    <div class="kpi-card navy"><div class="kpi-icon">🏆</div><div class="kpi-label">Asesor top</div><div class="kpi-value" style="font-size:1rem">${at?at[0].split(':')[1]?.trim()||at[0]:'—'}</div><div class="kpi-sub">${at?'$'+at[1].toFixed(2):'Sin datos'}</div></div>
    <div class="kpi-card accent"><div class="kpi-icon">📦</div><div class="kpi-label">Líneas de producto</div><div class="kpi-value">${datos.length}</div><div class="kpi-sub">unidades registradas</div></div>
  `;
  renderCharts(datos, pedidosConTotal);
  actualizarTablaCentral(datos);
  card.scrollIntoView({ behavior:'smooth', block:'start' });
}

function actualizarTablaCentral(datos) {
  const tbody = document.getElementById('tablaPedidos');
  const card  = document.getElementById('tableCard');
  card.style.display = 'block';
  pedidosDetalleActuales = datos;
  poblarClienteSelect(datos);
  document.getElementById('clienteCard').style.display = 'block';
  if (!datos.length) { tbody.innerHTML='<tr><td colspan="12"><div class="empty-state"><div class="icon">📋</div>No hay pedidos con estos filtros</div></td></tr>'; return; }
  tbody.innerHTML = datos.map(r => {
    const gps   = r['LINK GPS'] ? `<a href="${r['LINK GPS']}" target="_blank" style="color:var(--teal);font-weight:700;font-size:11px">📍 Ver</a>` : '<span style="color:var(--muted);font-size:11px">—</span>';
    const total = r['TOTAL PEDIDO ($)'] ? `<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>` : '';
    const pago  = r['FORMA DE PAGO'] ? `<span class="badge badge-teal">${r['FORMA DE PAGO']}</span>` : '';
    const accion = (r['_pedidoId'] && ROL_ACTUAL === 'admin') ? `<button class="btn-editar-fila" onclick="abrirEditarPedido('${r['_pedidoId']}')" title="Editar este pedido">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarPedidoCompleto('${r['_pedidoId']}')" title="Eliminar este pedido permanentemente">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>'; /* [NEW] Secretaria no ve Editar/Eliminar */
    return `<tr>
      <td style="white-space:nowrap;font-size:12px">${limpiarFecha(r['FECHA'])}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--muted)">${escHTML(r['HORA REGISTRO']||'-')}</td>
      <td style="font-size:12px">${escHTML((r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-')}</td>
      <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
      <td style="font-size:12px;color:var(--muted)">${escHTML(r['TELÉFONO']||'-')}</td>
      <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:center;font-size:12px">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right;font-size:12px;color:var(--muted)">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
      <td style="text-align:right">${total}</td>
      <td>${pago}</td>
      <td>${gps}</td>
      <td>${accion}</td>
    </tr>`;
  }).join('');
}

/* ════════════════════════════════════════
   LEAFLET
════════════════════════════════════════ */
function cargarLeaflet(callback) {
  if (leafletLoaded) { callback(); return; }
  const css = document.createElement('link'); css.rel='stylesheet'; css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
  const js = document.createElement('script'); js.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; js.integrity='sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH'; js.crossOrigin='anonymous'; js.onload=()=>{ leafletLoaded=true; callback(); }; document.head.appendChild(js);
}

function shadeColor(color, percent) {
  let R=parseInt(color.substring(1,3),16), G=parseInt(color.substring(3,5),16), B=parseInt(color.substring(5,7),16);
  R=Math.min(255,Math.max(0,R+percent)); G=Math.min(255,Math.max(0,G+percent)); B=Math.min(255,Math.max(0,B+percent));
  return '#'+[R,G,B].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function initLeafletMap() {
  leafletMap = L.map('leafletMap', { zoomControl:true, scrollWheelZoom:true });
  const tileCalles   = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap' });
  const tileSatelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:19, attribution:'© Esri' });
  tileCalles.addTo(leafletMap);
  const MapaCtrl = L.Control.extend({
    options: { position:'topleft' },
    onAdd: function() {
      const div = L.DomUtil.create('div','');
      div.innerHTML=`<div style="background:#fff;border-radius:4px;box-shadow:0 1px 5px rgba(0,0,0,0.25);overflow:hidden;display:flex;font-family:'DM Sans',sans-serif"><button id="btnMapa" onclick="setTile('mapa')" style="padding:6px 14px;font-size:12px;font-weight:700;border:none;background:#1a3a5c;color:#fff;cursor:pointer">Mapa</button><button id="btnSateli" onclick="setTile('satelite')" style="padding:6px 14px;font-size:12px;font-weight:600;border:none;background:#fff;color:#555;cursor:pointer;border-left:1px solid #ddd">Satélite</button></div>`;
      L.DomEvent.disableClickPropagation(div); return div;
    }
  });
  new MapaCtrl().addTo(leafletMap);
  window._tileCalles=tileCalles; window._tileSatelite=tileSatelite;
  leafletMap.setView([-2.134,-79.587],13);
}

function setTile(tipo) {
  if(tipo==='mapa'){
    leafletMap.removeLayer(window._tileSatelite); window._tileCalles.addTo(leafletMap);
    document.getElementById('btnMapa').style.cssText='padding:6px 14px;font-size:12px;font-weight:700;border:none;background:#1a3a5c;color:#fff;cursor:pointer';
    document.getElementById('btnSateli').style.cssText='padding:6px 14px;font-size:12px;font-weight:600;border:none;background:#fff;color:#555;cursor:pointer;border-left:1px solid #ddd';
  } else {
    leafletMap.removeLayer(window._tileCalles); window._tileSatelite.addTo(leafletMap);
    document.getElementById('btnSateli').style.cssText='padding:6px 14px;font-size:12px;font-weight:700;border:none;background:#1a3a5c;color:#fff;cursor:pointer;border-left:1px solid #ddd';
    document.getElementById('btnMapa').style.cssText='padding:6px 14px;font-size:12px;font-weight:600;border:none;background:#fff;color:#555;cursor:pointer';
  }
}

/* ════════════════════════════════════════
   RUTAS DEL DÍA
════════════════════════════════════════ */
function rutasHoy() { document.getElementById('rutasFecha').value = fechaHoy(); }
function aplicarRutas() {
  const fecha  = document.getElementById('rutasFecha').value;
  const asesor = document.getElementById('rutasAsesor').value;
  document.getElementById('rutasLastUpdate').textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'});
  renderRutasDia(fecha, asesor);
}

function parseCoordenada(val) {
  if (val===null||val===undefined||val==='') return NaN;
  const s=String(val).trim().replace(',','.');
  let n=parseFloat(s);
  if(isNaN(n)) return NaN;
  if(Math.abs(n)>1000) n=n/1000000;
  return n;
}

function coordValida(lat,lng) {
  if(isNaN(lat)||isNaN(lng)) return false;
  if(lat===0&&lng===0) return false;
  if(lat<-60||lat>15) return false;
  if(lng<-82||lng>-60) return false;
  return true;
}

function renderRutasDia(fecha, asesorFiltro) {
  if (!leafletMap) return;
  const diagBox=document.getElementById('gpsDiagBox'), diagContent=document.getElementById('gpsDiagContent');
  let datos=todosLosDatos;
  if(fecha) datos=datos.filter(r=>{ const f=String(r['FECHA']||''); return f.startsWith(fecha)||f.includes(fecha); });
  if(asesorFiltro) datos=datos.filter(r=>(r['ASESOR / RUTA']||'')===asesorFiltro);
  const sampleKeys=datos.length>0?Object.keys(datos[0]):[];
  const latKey=sampleKeys.find(k=>/latitud/i.test(k))||'LATITUD';
  const lngKey=sampleKeys.find(k=>/longitud/i.test(k))||'LONGITUD';
  const conCoordsRaw=datos.filter(r=>r[latKey]!==undefined&&r[latKey]!=='');
  const sinCoords=datos.filter(r=>!r[latKey]||r[latKey]==='');
  const datosGPS=datos.filter(r=>{ const lat=parseCoordenada(r[latKey]); const lng=parseCoordenada(r[lngKey]); return coordValida(lat,lng); }).map(r=>({...r,_lat:parseCoordenada(r[latKey]),_lng:parseCoordenada(r[lngKey])}));
  const diagLines=[];
  diagLines.push(`📋 Total registros filtrados: <b>${datos.length}</b>`);
  diagLines.push(`🔑 Clave LATITUD detectada: <b>"${latKey}"</b> | LONGITUD: <b>"${lngKey}"</b>`);
  diagLines.push(`📍 Con coordenadas en sheet: <b>${conCoordsRaw.length}</b> | Sin coordenadas: <b>${sinCoords.length}</b>`);
  diagLines.push(`✅ Coordenadas válidas para Ecuador: <b>${datosGPS.length}</b>`);
  if(conCoordsRaw.length>0&&datosGPS.length===0){
    const ej=conCoordsRaw[0];
    diagLines.push(`⚠️ Ejemplo de valor recibido → lat: <b>"${ej[latKey]}"</b> | lng: <b>"${ej[lngKey]}"</b>`);
    diagLines.push(`💡 <b>Posible causa:</b> Las coordenadas no están en rango Ecuador (-5 a +2 lat, -82 a -75 lng).`);
  } else if(datosGPS.length>0){
    const ej=datosGPS[0];
    diagLines.push(`📌 Ejemplo OK → lat: <b>${ej._lat}</b> | lng: <b>${ej._lng}</b> (${ej['CLIENTE']||''})`);
  }
  diagBox.style.display=(datosGPS.length===0||conCoordsRaw.length===0)?'block':'none';
  diagContent.innerHTML=diagLines.join('<br>');
  const pedidosDatos=datos.filter(r=>r['PRODUCTO']&&r['PRODUCTO']!=='');
  const datosOrdenados=[...pedidosDatos].sort((a,b)=>(horaAMinutos(a['HORA REGISTRO'])||0)-(horaAMinutos(b['HORA REGISTRO'])||0));
  const datosGPSOrdenados=[...datosGPS].sort((a,b)=>(horaAMinutos(a['HORA REGISTRO'])||0)-(horaAMinutos(b['HORA REGISTRO'])||0));
  mapMarkers.forEach(m=>m.remove()); mapPolylines.forEach(p=>p.remove()); mapMarkers=[]; mapPolylines=[];
  const rutasMap={};
  datosGPSOrdenados.forEach(r=>{ const a=r['ASESOR / RUTA']||'Sin asignar'; if(!rutasMap[a])rutasMap[a]=[]; rutasMap[a].push(r); });
  let allBounds=[];
  const markerRefs={};
  Object.entries(rutasMap).forEach(([asesorKey,filas])=>{
    const color=RUTA_COLORS[asesorKey]||'#e67e22';
    const coords=[];
    filas.forEach((r,idx)=>{
      const lat=r._lat, lng=r._lng;
      const precision=parseCoordenada(r['PRECISIÓN GPS'])||0;
      const num=idx+1;
      const borderClr=shadeColor(color,-25);
      const personaSVG=`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="7" r="4"/><path d="M5.5 20c0-3.59 2.91-6.5 6.5-6.5s6.5 2.91 6.5 6.5H5.5z"/></svg>`;
      const iconHtml=`<div style="position:relative;width:42px;height:52px;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.4))"><svg xmlns="http://www.w3.org/2000/svg" width="42" height="52" viewBox="0 0 42 52" style="position:absolute;top:0;left:0"><path d="M21 1C10.5 1 2 9.5 2 20c0 14 19 31 19 31s19-17 19-31C40 9.5 31.5 1 21 1z" fill="${color}" stroke="${borderClr}" stroke-width="2"/><circle cx="21" cy="19" r="13" fill="rgba(255,255,255,0.18)"/></svg><div style="position:absolute;top:5px;left:50%;transform:translateX(-50%);width:18px;height:18px">${personaSVG}</div><div style="position:absolute;top:-4px;right:-4px;background:#fff;color:${color};border:2px solid ${color};border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;line-height:1;font-family:'DM Sans',sans-serif;box-shadow:0 1px 4px rgba(0,0,0,0.3)">${num}</div></div>`;
      const icon=L.divIcon({className:'',html:iconHtml,iconSize:[42,52],iconAnchor:[21,52],popupAnchor:[0,-54]});
      const marker=L.marker([lat,lng],{icon}).addTo(leafletMap);
      const nombreAsesor=escHTML(asesorKey.split(':')[1]?.trim()||asesorKey);
      const prod=r['PRODUCTO']?`<b>${escHTML(r['PRODUCTO'])}</b> × ${escHTML(String(r['CANTIDAD']||0))}`:'—';
      const total=r['TOTAL PEDIDO ($)']?`<span style="color:#0a7c6e;font-weight:700">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</span>`:'—';
      const notas=r['NOTAS']?`<div style="margin-top:6px;font-style:italic;color:#555;font-size:11px">📝 ${escHTML(r['NOTAS'])}</div>`:'';
      const linkgps=r['LINK GPS']?`<a href="${r['LINK GPS']}" target="_blank" style="display:inline-block;margin-top:8px;background:#0a7c6e;color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none">📍 Abrir GPS</a>`:'';
      const precStr=precision>0?`<div style="font-size:10px;color:#999;margin-top:2px">Precisión: ${precision}m${precision>50?' ⚠️':''}</div>`:'';
      marker.bindPopup(`<div style="font-family:'DM Sans',sans-serif;min-width:200px;max-width:240px"><div style="background:${color};color:#fff;padding:8px 12px;margin:-13px -20px 10px;border-radius:4px 4px 0 0;font-size:12px;font-weight:700">${nombreAsesor} — Parada #${idx+1}</div><div style="font-size:13px;font-weight:700;color:#1a3a5c">${escHTML(r['CLIENTE']||'-')}</div><div style="font-size:11px;color:#666;margin-top:2px">🕐 ${r['HORA REGISTRO']||'-'}</div>${precStr}<div style="margin-top:8px;font-size:12px">${prod}</div><div style="margin-top:2px;font-size:12px">Total: ${total}</div><div style="margin-top:4px;font-size:11px;color:#888">💳 ${r['FORMA DE PAGO']||'—'}</div>${notas}${linkgps}</div>`,{maxWidth:260});
      if(precision>50){ const circle=L.circle([lat,lng],{radius:precision,color,fillColor:color,fillOpacity:0.08,weight:1,dashArray:'4,4'}).addTo(leafletMap); mapMarkers.push(circle); }
      mapMarkers.push(marker); coords.push([lat,lng]); allBounds.push([lat,lng]);
      const key=`${r['CLIENTE']}-${r['HORA REGISTRO']}-${asesorKey}`;
      markerRefs[key]=marker;
    });
    if(coords.length>1){ const poly=L.polyline(coords,{color:'#1a6fd4',weight:3.5,opacity:0.88,lineJoin:'round',lineCap:'round'}).addTo(leafletMap); mapPolylines.push(poly); }
  });
  if(allBounds.length>0) leafletMap.fitBounds(allBounds,{padding:[40,40]});
  renderMapLegend(Object.keys(rutasMap));
  renderAsesorCards(datosOrdenados,datosGPSOrdenados);
  renderRutaTabla(datosOrdenados,markerRefs);
}

function renderMapLegend(asesores) {
  const el=document.getElementById('mapLegend');
  if(!asesores.length){ el.innerHTML='<span style="font-size:11px;color:var(--muted)">Sin datos GPS</span>'; return; }
  el.innerHTML=asesores.map(a=>{ const color=RUTA_COLORS[a]||'#555'; const nombre=a.split(':')[1]?.trim()||a; return `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div>${nombre}</div>`; }).join('');
}

function centrarMapa() {
  if(!leafletMap) return;
  const fecha=document.getElementById('rutasFecha').value, asesor=document.getElementById('rutasAsesor').value;
  let datos=todosLosDatos;
  if(fecha) datos=datos.filter(r=>String(r['FECHA']||'').startsWith(fecha));
  if(asesor) datos=datos.filter(r=>(r['ASESOR / RUTA']||'')===asesor);
  const sampleKeys=datos.length>0?Object.keys(datos[0]):[];
  const latKey=sampleKeys.find(k=>/latitud/i.test(k))||'LATITUD';
  const lngKey=sampleKeys.find(k=>/longitud/i.test(k))||'LONGITUD';
  const bounds=datos.map(r=>[parseCoordenada(r[latKey]),parseCoordenada(r[lngKey])]).filter(([lat,lng])=>coordValida(lat,lng));
  if(bounds.length) leafletMap.fitBounds(bounds,{padding:[40,40]});
  else leafletMap.setView([-2.134,-79.587],13);
}

function haversineKm(lat1,lon1,lat2,lon2) {
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function renderAsesorCards(datosAll,datosGPS) {
  const grid=document.getElementById('asesorCardsGrid');
  const asesorMap={};
  datosAll.forEach(r=>{ const a=r['ASESOR / RUTA']||'Sin asignar'; if(!asesorMap[a])asesorMap[a]={filas:[],gps:[]}; asesorMap[a].filas.push(r); });
  datosGPS.forEach(r=>{ const a=r['ASESOR / RUTA']||'Sin asignar'; if(!asesorMap[a])asesorMap[a]={filas:[],gps:[]}; asesorMap[a].gps.push(r); });
  if(!Object.keys(asesorMap).length){ grid.innerHTML='<div class="loading"><span style="color:var(--muted)">📭 Sin datos para el filtro seleccionado</span></div>'; return; }
  grid.innerHTML=Object.entries(asesorMap).map(([asesorKey,data])=>{
    const color=RUTA_COLORS[asesorKey]||'#555', nombre=asesorKey.split(':')[1]?.trim()||asesorKey;
    const filas=data.filas, gps=data.gps;
    const clientes=new Set(filas.map(r=>`${r['CLIENTE']}-${r['FECHA']}`)).size;
    const total=filas.filter(r=>r['TOTAL PEDIDO ($)']&&parseFloat(r['TOTAL PEDIDO ($)'])>0).reduce((s,r)=>s+(parseFloat(r['TOTAL PEDIDO ($)'])||0),0);
    const horas=filas.map(r=>r['HORA REGISTRO']).filter(Boolean).sort((a,b)=>(horaAMinutos(a)||0)-(horaAMinutos(b)||0));
    const primerHora=horas[0]||'—', ultimaHora=horas[horas.length-1]||'—';
    let km=0;
    for(let i=1;i<gps.length;i++){ const lat1=gps[i-1]._lat,lon1=gps[i-1]._lng,lat2=gps[i]._lat,lon2=gps[i]._lng; if(!isNaN(lat1)&&!isNaN(lon1)&&!isNaN(lat2)&&!isNaN(lon2))km+=haversineKm(lat1,lon1,lat2,lon2); }
    return `<div class="asesor-card" style="border-left-color:${color};animation-delay:${Object.keys(asesorMap).indexOf(asesorKey)*0.05}s">
      <div class="asesor-card-header"><div class="asesor-dot" style="background:${color}"></div><div class="asesor-nombre" style="color:${color}">${nombre}</div></div>
      <div class="asesor-stats">
        <div class="asesor-stat"><div class="asesor-stat-label">Clientes</div><div class="asesor-stat-value" style="color:${color}">${clientes}</div></div>
        <div class="asesor-stat"><div class="asesor-stat-label">Total vendido</div><div class="asesor-stat-value" style="color:${color};font-size:1rem">$${total.toFixed(2)}</div></div>
      </div>
      <div class="asesor-horario">
        <div><div class="asesor-horario-label">Primer pedido</div><div class="asesor-horario-value">🕐 ${primerHora}</div></div>
        <div style="text-align:right"><div class="asesor-horario-label">Último pedido</div><div class="asesor-horario-value">🕐 ${ultimaHora}</div></div>
      </div>
      <div class="asesor-km"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 1a5 5 0 0 1 5 5c0 3.5-5 9-5 9S3 9.5 3 6a5 5 0 0 1 5-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="6" r="1.5" stroke="currentColor" stroke-width="1.5"/></svg>${km>0?km.toFixed(1)+' km recorridos':'Sin ruta GPS trazada'}</div>
    </div>`;
  }).join('');
}

function renderRutaTabla(datos,markerRefs) {
  const card=document.getElementById('rutaDetailCard'),tbody=document.getElementById('tablaRutaDetalle'),badge=document.getElementById('rutaCountBadge'),note=document.getElementById('rutaTableNote');
  if(!datos.length){ card.style.display='block'; tbody.innerHTML='<tr><td colspan="11"><div class="empty-state"><div class="icon">🗺️</div>Sin registros para este filtro</div></td></tr>'; badge.textContent='0 registros'; note.textContent=''; return; }
  const mostrar=datos.slice(0,200);
  card.style.display='block'; badge.textContent=mostrar.length+' registro'+(mostrar.length!==1?'s':'');
  note.textContent=datos.length>200?`Mostrando 200 de ${datos.length} registros totales.`:'';
  tbody.innerHTML=mostrar.map((r,idx)=>{
    const asesorKey=r['ASESOR / RUTA']||'', color=RUTA_COLORS[asesorKey]||'#ccc', nombre=asesorKey.split(':')[1]?.trim()||asesorKey||'-';
    const total=r['TOTAL PEDIDO ($)']?`<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>`:'<span style="color:var(--muted)">—</span>';
    const pago=r['FORMA DE PAGO']?`<span class="badge badge-teal">${r['FORMA DE PAGO']}</span>`:'';
    const notas=r['NOTAS']?`<span style="font-size:11px;color:var(--muted);font-style:italic" title="${escapeAttr(r['NOTAS'])}">${escHTML(r['NOTAS'].substring(0,30))}${r['NOTAS'].length>30?'…':''}</span>`:'<span style="color:var(--muted);font-size:11px">—</span>';
    const gps=r['LINK GPS']?`<a class="btn-gps-small" href="${r['LINK GPS']}" target="_blank" onclick="event.stopPropagation()">📍 Ver</a>`:'<span style="color:var(--muted);font-size:11px">—</span>';
    const hasGPS=!isNaN(parseFloat(r['LATITUD']))&&!isNaN(parseFloat(r['LONGITUD']));
    const rowClick=hasGPS?`onclick="flyToMarker('${(r['CLIENTE']+'-'+r['HORA REGISTRO']+'-'+asesorKey).replace(/'/g,"\\'")}',${parseFloat(r['LATITUD'])},${parseFloat(r['LONGITUD'])})"`:'';
    const rowClass=hasGPS?'clickable-row':'';
    return `<tr class="${rowClass}" id="rrow-${idx}" ${rowClick} ${hasGPS?'title="Click para ver en el mapa"':''}>
      <td style="text-align:center;font-size:11px;color:var(--muted);font-weight:700">${idx+1}</td>
      <td><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block"></span><span style="font-size:11px;font-weight:700;color:${color}">${nombre}</span></span></td>
      <td style="font-size:12px;font-weight:700;white-space:nowrap">${r['HORA REGISTRO']||'-'}</td>
      <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
      <td style="font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAttr(r['DIRECCIÓN']||'')}">${escHTML(r['DIRECCIÓN']||'-')}</td>
      <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:center;font-size:12px;font-weight:700">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right">${total}</td>
      <td>${pago}</td>
      <td>${notas}</td>
      <td>${gps}</td>
    </tr>`;
  }).join('');
}

function flyToMarker(key,lat,lng) {
  if(!leafletMap) return;
  document.querySelectorAll('#tablaRutaDetalle tr').forEach(tr=>tr.classList.remove('highlight-row'));
  leafletMap.flyTo([lat,lng],17,{duration:1});
  setTimeout(()=>{
    mapMarkers.forEach(m=>{ if(m.getLatLng){ const ml=m.getLatLng(); if(Math.abs(ml.lat-lat)<0.0001&&Math.abs(ml.lng-lng)<0.0001&&m.openPopup)m.openPopup(); } });
    document.getElementById('leafletMap').scrollIntoView({behavior:'smooth',block:'center'});
  },900);
}

function exportarClientePDF() {
  if (!clientesSeleccionados.length) { alert('Selecciona al menos un cliente primero.'); return; }
  const items = pedidosDetalleActuales.filter(r => clientesSeleccionados.includes(r['CLIENTE']));
  if (!items.length) { alert('No hay pedidos para estos clientes en el filtro actual.'); return; }

  const fecha = document.getElementById('filtroFecha').value || 'Todos los registros';
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const asesorLabel = asesorSel.split(':')[1]?.trim() || 'Todos';

  const porCliente = {};
  items.forEach(r => { const c = r['CLIENTE']||'Sin nombre'; if (!porCliente[c]) porCliente[c] = []; porCliente[c].push(r); });

  let totalGeneralTodos = 0;
  const bloquesHtml = clientesSeleccionados.filter(c => porCliente[c]).map(cliente => {
    let totalCliente = 0;
    const filas = porCliente[cliente].map(r => {
      const valorTotal = parseFloat(r['SUBTOTAL']||0);
      totalCliente += valorTotal;
      const totalPedido = r['TOTAL PEDIDO ($)'] ? `$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}` : '—';
      return `<tr>
        <td>${escHTML(r['PRODUCTO']||'-')}</td>
        <td style="text-align:center">${r['CANTIDAD']||'-'}</td>
        <td style="text-align:right">$${valorTotal.toFixed(2)}</td>
        <td style="text-align:right;font-weight:700">${totalPedido}</td>
        <td>${r['FORMA DE PAGO']||'-'}</td>
      </tr>`;
    }).join('');
    totalGeneralTodos += totalCliente;
    return `
      <div class="cliente-bloque">
        <div class="cliente-bloque-titulo">👤 ${escHTML(cliente)} <span>$${totalCliente.toFixed(2)}</span></div>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th><th>Subtotal</th><th>Total</th><th>Pago</th></tr></thead>
          <tbody>
            ${filas}
            <tr class="total-row"><td colspan="2" style="text-align:right">SUBTOTAL</td><td style="text-align:right">$${totalCliente.toFixed(2)}</td><td colspan="2"></td></tr>
          </tbody>
        </table>
      </div>`;
  }).join('');

  const v = window.open('', '_blank', 'width=800,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Detalle de Clientes — Luan Aqua</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:22px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    .cliente-bloque{margin-bottom:22px;page-break-inside:avoid;}
    .cliente-bloque-titulo{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:800;color:#1a3a5c;background:#f0f5f8;border-radius:8px 8px 0 0;padding:8px 12px;border:1px solid #ddd;border-bottom:none;}
    .cliente-bloque-titulo span{color:#0a7c6e;font-family:'DM Serif Display',serif;font-size:16px;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    thead tr{background:#1a3a5c;}
    thead th{padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#fff;}
    thead th:nth-child(2),thead th:nth-child(3),thead th:nth-child(4){text-align:right}
    thead th:nth-child(2){text-align:center}
    tbody td{padding:9px 12px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
    .total-row{background:#e6f4f2;font-weight:800;color:#085f54;}
    .total-row td{padding:12px;border-top:2px solid #0a7c6e;}
    .total-final{background:#1a3a5c;border-radius:10px;padding:14px 18px;margin-top:10px;display:flex;justify-content:space-between;align-items:center;color:#fff;}
    .total-final b{font-family:'DM Serif Display',serif;font-size:18px;color:#4ec9a0;}
    @media print{body{padding:12px;} thead{display:table-header-group;}}
  </style></head><body>
  <div class="print-header">
    <h1>🔍 Detalle de Clientes — Luan Aqua</h1>
    <p>${clientesSeleccionados.length} cliente(s) · Asesor: ${asesorLabel} · Fecha: ${fecha} · Generado: ${new Date().toLocaleString('es-EC')}</p>
  </div>
  ${bloquesHtml}
  ${clientesSeleccionados.length > 1 ? `<div class="total-final"><span>TOTAL GENERAL (${clientesSeleccionados.length} clientes)</span><b>$${totalGeneralTodos.toFixed(2)}</b></div>` : ''}
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  v.document.close();
}

/* ════════════════════════════════════════
   CONSULTAR POR CLIENTE
════════════════════════════════════════ */
/* [NEW] Estado de negocio de un cliente, según reglas exactas del negocio:
   VIP: última compra <=30 días Y total histórico >= $500
   ACTIVO: última compra <=30 días Y total histórico < $500
   RIESGO: última compra entre 31 y 60 días
   INACTIVO: última compra >60 días (o nunca ha comprado en el período analizado) */
function _calcularEstadoCliente(diasSinPedido, totalHistorico) {
  if (diasSinPedido <= 30) return totalHistorico >= 500 ? 'VIP' : 'Activo';
  if (diasSinPedido <= 60) return 'Riesgo';
  return 'Inactivo';
}
function _badgeEstadoCliente(estado) {
  const map = {
    'VIP':      '<span class="badge" style="background:#f3e5f5;color:#7b1fa2">VIP</span>',
    'Activo':   '<span class="badge badge-teal">Activo</span>',
    'Riesgo':   '<span class="badge" style="background:#fdf0e2;color:#c05800">Riesgo</span>',
    'Inactivo': '<span class="badge" style="background:#fbe9e7;color:var(--red)">Inactivo</span>'
  };
  return map[estado] || estado;
}

let _clientesTablaDatos = []; // [NEW] estadísticas calculadas por cliente, para la tabla/modal/PDF
let _clientesSeleccionadosPdf = new Set(); // [NEW] checkboxes marcados para exportar

/* [FIX] Esta función se había perdido al reescribir el bloque — agrupa las líneas de
   producto de un mismo pedido real (Cliente+Fecha+Asesor) en un solo grupo. */
function _agruparPedidosReales(datos) {
  const grupos = [];
  let actual = null;
  datos.forEach(r => {
    const total = parseFloat(r['TOTAL PEDIDO ($)']||0);
    if (total > 0) {
      actual = { total, cliente: r['CLIENTE']||'Sin nombre', items: [r] };
      grupos.push(actual);
    } else if (actual) {
      actual.items.push(r);
    } else {
      actual = { total: 0, cliente: r['CLIENTE']||'Sin nombre', items: [r] };
      grupos.push(actual);
    }
  });
  return grupos;
}

function poblarClienteSelect(datos) {
  // [NEW] Calcula, para cada cliente que aparece en el período filtrado (fecha/asesor de
  // arriba), sus estadísticas: pedidos, valor total, último pedido, días sin comprar,
  // asesor (el de su pedido más reciente), estado (VIP/Activo/Riesgo/Inactivo) y Deuda
  // Vigente (esta última siempre sobre TODO el historial, sin filtro de fecha — igual que
  // antes, porque una deuda no se limita a un día en particular).
  const gruposPedido = _agruparPedidosReales(datos);
  const porCliente = {};
  gruposPedido.forEach(g => {
    const primeraLinea = g.items[0] || {};
    if (!porCliente[g.cliente]) porCliente[g.cliente] = { pedidos: 0, total: 0, ultimoFecha: '', asesor: '', telefono: '', direccion: '', items: [] };
    const c = porCliente[g.cliente];
    c.pedidos++;
    c.total += g.total || 0;
    g.items.forEach(r => {
      c.items.push(r);
      if (!c.telefono && r['TELÉFONO']) c.telefono = r['TELÉFONO'];
      if (!c.direccion && r['DIRECCIÓN']) c.direccion = r['DIRECCIÓN'];
    });
    // gruposPedido viene del más reciente al más antiguo (Firestore ordena por creadoEn desc,
    // ordenado del lado del navegador) — el primer grupo visto por cliente es su pedido más
    // reciente, así que fijamos fecha/asesor solo la primera vez.
    if (!c.ultimoFecha) { c.ultimoFecha = primeraLinea['FECHA'] || ''; c.asesor = primeraLinea['ASESOR / RUTA'] || ''; }
  });

  const hoyMs = Date.now();
  _clientesTablaDatos = Object.entries(porCliente).map(([nombre, c]) => {
    const ultimoDate = c.ultimoFecha ? new Date(c.ultimoFecha + 'T00:00:00') : null;
    const diasSinPedido = ultimoDate ? Math.max(0, Math.floor((hoyMs - ultimoDate.getTime()) / 86400000)) : 9999;
    const estado = _calcularEstadoCliente(diasSinPedido, c.total);
    // Deuda Vigente — sobre TODO el historial del cliente, sin filtro de fecha (igual que antes)
    const _todosPedidosCliente = todosLosDatos.filter(r => r['CLIENTE'] === nombre && r['PRODUCTO'] && parseFloat(r['TOTAL PEDIDO ($)']||0) > 0);
    const _creditoTotalCliente = _todosPedidosCliente.filter(r => (r['FORMA DE PAGO']||'') === 'Crédito').reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
    const _pagosTotalCliente = todosLosDatos.filter(r => r['CLIENTE'] === nombre && !r['PRODUCTO'] && parseFloat(r['TOTAL PEDIDO ($)']||0) > 0 && String(r['TOTAL PEDIDO ($)']).indexOf('-') === -1).reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
    const deudaVigente = _creditoTotalCliente - _pagosTotalCliente;
    return {
      nombre, telefono: c.telefono, direccion: c.direccion, pedidos: c.pedidos, total: c.total,
      ultimoFecha: c.ultimoFecha, diasSinPedido, asesor: c.asesor, estado, deudaVigente, items: c.items
    };
  });

  // Población del filtro "Todos los asesores" con las rutas reales
  const selAsesor = document.getElementById('clienteFiltroAsesorTabla');
  if (selAsesor) {
    const valorActual = selAsesor.value;
    selAsesor.innerHTML = '<option value="">Todos los asesores</option>' + _asesoresCache.map(r => `<option value="${escapeAttr(r)}">${r.split(':')[1]?.trim()||r}</option>`).join('');
    if (_asesoresCache.includes(valorActual)) selAsesor.value = valorActual;
  }

  _clientesSeleccionadosPdf.clear(); // el filtro cambió, se limpia la selección de PDF para evitar exportar algo que ya no se ve
  mostrarDetalleCliente();
}

/* [NEW] Pinta la tabla de "Consultar por Cliente" respetando los filtros de búsqueda,
   estado y asesor — y ordenada por llegada (más reciente primero), como ya funcionaba. */
function mostrarDetalleCliente() {
  const cont = document.getElementById('clienteDetalleContenido');
  const contador = document.getElementById('clienteContadorTabla');
  if (!cont) return;

  const q = (document.getElementById('clienteBusquedaTabla')?.value || '').toLowerCase().trim();
  const estadoFiltro = document.getElementById('clienteFiltroEstado')?.value || '';
  const asesorFiltro = document.getElementById('clienteFiltroAsesorTabla')?.value || '';

  let filtrados = _clientesTablaDatos.filter(c => {
    const matchQ = !q || c.nombre.toLowerCase().includes(q) || (c.telefono||'').includes(q) || (c.direccion||'').toLowerCase().includes(q);
    const matchEstado = !estadoFiltro || c.estado === estadoFiltro;
    const matchAsesor = !asesorFiltro || c.asesor === asesorFiltro;
    return matchQ && matchEstado && matchAsesor;
  });
  // Ya vienen en orden de llegada (más reciente primero) desde poblarClienteSelect, gracias
  // al orden de gruposPedido — el filtro de arriba solo reduce la lista, no cambia el orden.

  if (contador) contador.textContent = filtrados.length + ' cliente' + (filtrados.length!==1?'s':'');

  if (!filtrados.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:2rem"><div class="icon">👤</div>No hay clientes que coincidan con estos filtros</div>';
    return;
  }

  const filas = filtrados.map(c => {
    const checked = _clientesSeleccionadosPdf.has(c.nombre) ? 'checked' : '';
    const asesorNombre = (c.asesor||'').split(':')[1]?.trim() || c.asesor || '-';
    const deudaTexto = c.deudaVigente > 0.005 ? `<div style="font-size:11px;font-weight:700;color:var(--red)">$${c.deudaVigente.toFixed(2)}</div>` : '<span style="color:var(--muted);font-size:11px">—</span>';
    return `<tr class="clickable" style="cursor:pointer" onclick="if(event.target.type!=='checkbox')abrirDetalleClienteModal('${encodeURIComponent(c.nombre)}')">
      <td onclick="event.stopPropagation()"><input type="checkbox" ${checked} onchange="toggleClienteSeleccionadoPdf('${encodeURIComponent(c.nombre)}',this.checked)" style="width:16px;height:16px;accent-color:var(--teal);cursor:pointer"></td>
      <td style="font-weight:700;color:var(--navy)">${escHTML(c.nombre)}</td>
      <td style="font-size:12px;color:var(--muted)">${escHTML(c.telefono||'-')}</td>
      <td style="font-size:12px;color:var(--muted);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeAttr(c.direccion||'')}">${escHTML(c.direccion||'-')}</td>
      <td style="text-align:center">${c.pedidos}</td>
      <td style="text-align:right;font-weight:700;color:var(--teal)">$${c.total.toFixed(2)}</td>
      <td style="font-size:12px;white-space:nowrap">${limpiarFecha(c.ultimoFecha)}<br><small style="color:var(--muted)">${c.diasSinPedido} días</small></td>
      <td style="font-size:12px">${escHTML(asesorNombre)}</td>
      <td>${_badgeEstadoCliente(c.estado)}</td>
      <td>${deudaTexto}</td>
    </tr>`;
  }).join('');

  cont.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th></th><th>Cliente</th><th>Teléfono</th><th>Dirección</th><th style="text-align:center">Pedidos</th><th style="text-align:right">Valor Total</th><th>Último pedido</th><th>Asesor</th><th>Estado</th><th>Deuda</th></tr></thead>
    <tbody>${filas}</tbody>
  </table></div>`;

  _actualizarBotonExportarClientes();
}

function toggleClienteSeleccionadoPdf(nombreCodificado, marcado) {
  const nombre = decodeURIComponent(nombreCodificado);
  if (marcado) _clientesSeleccionadosPdf.add(nombre);
  else _clientesSeleccionadosPdf.delete(nombre);
  _actualizarBotonExportarClientes();
}
function _actualizarBotonExportarClientes() {
  const btn = document.getElementById('btnExportarClientesSeleccionados');
  const txt = document.getElementById('btnExportarClientesTexto');
  if (!btn) return;
  const n = _clientesSeleccionadosPdf.size;
  btn.style.display = n > 0 ? 'flex' : 'none';
  if (txt) txt.textContent = `Exportar ${n} seleccionado${n!==1?'s':''} a PDF`;
}

/* [NEW] Modal 360° del cliente — KPIs, Deuda Vigente e historial de pedidos completo */
function abrirDetalleClienteModal(nombreCodificado) {
  const nombre = decodeURIComponent(nombreCodificado);
  const c = _clientesTablaDatos.find(x => x.nombre === nombre);
  if (!c) return;
  document.getElementById('modalClienteNombre').textContent = c.nombre;
  document.getElementById('modalClienteSub').textContent = `${c.telefono||'-'} · ${c.direccion||'-'}`;
  const deudaHtml = c.deudaVigente > 0.005
    ? `<div class="detail-item-dash"><label>Deuda Vigente</label><strong style="color:var(--red)">$${c.deudaVigente.toFixed(2)}</strong></div>`
    : `<div class="detail-item-dash"><label>Deuda Vigente</label><strong style="color:var(--teal)">✅ Al día</strong></div>`;
  document.getElementById('modalClienteStats').innerHTML = `
    <div class="detail-item-dash"><label>Pedidos</label><strong>${c.pedidos}</strong></div>
    <div class="detail-item-dash"><label>Valor total</label><strong>$${c.total.toFixed(2)}</strong></div>
    <div class="detail-item-dash"><label>Último pedido</label><strong>${limpiarFecha(c.ultimoFecha)}</strong></div>
    <div class="detail-item-dash"><label>Días sin compra</label><strong>${c.diasSinPedido}</strong></div>
    <div class="detail-item-dash"><label>Asesor</label><strong>${escHTML((c.asesor||'').split(':')[1]?.trim()||c.asesor||'-')}</strong></div>
    <div class="detail-item-dash"><label>Estado</label>${_badgeEstadoCliente(c.estado)}</div>
    ${deudaHtml}
  `;
  const filasHistorial = c.items.map(r => `<tr>
    <td style="font-size:12px">${limpiarFecha(r['FECHA'])}</td>
    <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
    <td style="text-align:center">${r['CANTIDAD']||'-'}</td>
    <td style="text-align:right;font-weight:700;color:var(--teal)">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
    <td><span class="badge badge-teal">${escHTML(r['FORMA DE PAGO']||'-')}</span></td>
  </tr>`).join('');
  document.getElementById('modalClienteHistorial').innerHTML = filasHistorial || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Sin historial de productos</td></tr>';
  const tel = (c.telefono||'').replace(/\D/g,'');
  const waBtn = document.getElementById('modalClienteWa');
  if (waBtn) waBtn.href = tel ? `https://wa.me/593${tel.replace(/^0/,'')}` : '#';
  window._clienteModalActual = c; // para el botón de imprimir
  document.getElementById('modalClienteOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function cerrarDetalleClienteModal() {
  document.getElementById('modalClienteOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* [NEW] Imprimir / PDF de UN cliente, desde el modal 360° */
function imprimirClienteModal() {
  const c = window._clienteModalActual;
  if (!c) return;
  _imprimirClientesPDF([c]);
}
/* [NEW] Exporta a PDF los clientes marcados con checkbox en la tabla */
function exportarClientesSeleccionadosPDF() {
  const seleccionados = _clientesTablaDatos.filter(c => _clientesSeleccionadosPdf.has(c.nombre));
  if (!seleccionados.length) { alert('Selecciona al menos un cliente primero.'); return; }
  _imprimirClientesPDF(seleccionados);
}
function _imprimirClientesPDF(clientesArr) {
  const bloques = clientesArr.map(c => {
    const filas = c.items.map(r => `<tr><td>${escHTML(r['PRODUCTO']||'-')}</td><td style="text-align:center">${r['CANTIDAD']||'-'}</td><td style="text-align:right">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td><td>${escHTML(r['FORMA DE PAGO']||'-')}</td></tr>`).join('');
    return `<div class="bloque-cliente-pdf">
      <h2>${escHTML(c.nombre)}</h2>
      <p class="sub">${escHTML(c.telefono||'-')} · ${escHTML(c.direccion||'-')}</p>
      <div class="stats">
        <div><label>Pedidos</label><span>${c.pedidos}</span></div>
        <div><label>Valor total</label><span>$${c.total.toFixed(2)}</span></div>
        <div><label>Último pedido</label><span>${limpiarFecha(c.ultimoFecha)}</span></div>
        <div><label>Estado</label><span>${c.estado}</span></div>
        <div><label>Deuda Vigente</label><span>${c.deudaVigente>0.005?'$'+c.deudaVigente.toFixed(2):'Al día'}</span></div>
      </div>
      <table><thead><tr><th>Producto</th><th>Cant.</th><th>Subtotal</th><th>Pago</th></tr></thead><tbody>${filas}</tbody></table>
    </div>`;
  }).join('<hr>');
  const v = window.open('', '_blank', 'width=800,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Clientes — Luan Aqua</title>
  <style>
    body{font-family:Arial,sans-serif;color:#1a3a5c;padding:24px}
    h2{font-family:Georgia,serif;font-size:20px;margin-bottom:2px}
    .sub{font-size:12px;color:#888;margin-bottom:14px}
    .stats{display:flex;gap:16px;flex-wrap:wrap;background:#f0f5f8;border-radius:10px;padding:12px 16px;margin-bottom:14px}
    .stats div{display:flex;flex-direction:column}
    .stats label{font-size:9px;font-weight:700;text-transform:uppercase;color:#888}
    .stats span{font-size:14px;font-weight:700}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px}
    th{background:#1a3a5c;color:#fff;padding:8px 10px;text-align:left}
    td{padding:7px 10px;border-bottom:1px solid #eee}
    hr{border:none;border-top:2px dashed #ccc;margin:24px 0}
  </style></head><body>${bloques}<script>window.onload=function(){window.print();}<\/script></body></html>`);
  v.document.close();
}


/* ════════════════════════════════════════════════════════════
   [NEW] REPORTE POR ASESOR — clic en una tarjeta para ver el
   detalle completo: ventas, productos, regalías, cobrado, gastos
   y desglose por forma de pago, respetando el filtro de fecha
   general del dashboard (pero ignorando el filtro de asesor, para
   poder ver siempre todas las tarjetas).
════════════════════════════════════════════════════════════ */
let _asesorReporteSeleccionado = null;

function renderReporteAsesores(){
  const grid = document.getElementById('reporteAsesorCardsGrid');
  if (!grid) return;
  const datos = getDatosSoloFecha();
  const pedidosConTotal = datos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== '' && r['TOTAL PEDIDO ($)'] && parseFloat(r['TOTAL PEDIDO ($)']) > 0);
  const ventasPorRuta = {};
  pedidosConTotal.forEach(r => { const a = r['ASESOR / RUTA']||''; ventasPorRuta[a] = (ventasPorRuta[a]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });

  if (!_asesoresCache.length) { grid.innerHTML = '<div class="empty-state"><div class="icon">👤</div>No hay asesores registrados</div>'; return; }

  grid.innerHTML = _asesoresCache.map(ruta => {
    const color = RUTA_COLORS[ruta] || '#555';
    const nombre = ruta.split(':')[1]?.trim() || ruta;
    const total = ventasPorRuta[ruta] || 0;
    const activo = ruta === _asesorReporteSeleccionado;
    return `<div class="asesor-card" style="border-left-color:${color};cursor:pointer;${activo?'box-shadow:0 0 0 2px '+color+', var(--shadow)':''}" onclick="seleccionarAsesorReporte('${ruta.replace(/'/g,"\\'")}')">
      <div class="asesor-card-header"><div class="asesor-dot" style="background:${color}"></div><div class="asesor-nombre" style="color:${color}">${nombre}</div></div>
      <div class="asesor-stats"><div class="asesor-stat"><div class="asesor-stat-label">Ventas del período</div><div class="asesor-stat-value" style="color:${color}">$${total.toFixed(2)}</div></div></div>
    </div>`;
  }).join('');

  if (_asesorReporteSeleccionado) renderReporteAsesorDetalle();
}

function seleccionarAsesorReporte(ruta){
  _asesorReporteSeleccionado = ruta;
  renderReporteAsesores();
  renderReporteAsesorDetalle();
  const wrap = document.getElementById('reporteAsesorDetalleWrap');
  if (wrap) wrap.scrollIntoView({ behavior:'smooth', block:'start' });
}

function renderReporteAsesorDetalle(){
  const wrap = document.getElementById('reporteAsesorDetalleWrap');
  if (!wrap || !_asesorReporteSeleccionado) return;
  wrap.style.display = 'block';
  const ruta = _asesorReporteSeleccionado;
  const nombre = ruta.split(':')[1]?.trim() || ruta;
  const datos = getDatosSoloFecha().filter(r => (r['ASESOR / RUTA']||'') === ruta);
  const pedidos = datos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== '');
  const pagos   = datos.filter(r => !r['PRODUCTO'] && r['TOTAL PEDIDO ($)'] > 0 && String(r['TOTAL PEDIDO ($)']).indexOf('-') === -1);
  const gastos  = datos.filter(r => String(r['TOTAL PEDIDO ($)']).indexOf('-') !== -1);
  const pedidosConTotal = pedidos.filter(r => r['TOTAL PEDIDO ($)'] && parseFloat(r['TOTAL PEDIDO ($)']) > 0);

  const totalVentas  = pedidosConTotal.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalCobrado = pagos.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalGastos  = gastos.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const clientesUnicos = new Set(pedidos.map(r => r['CLIENTE'])).size;
  const pedidosUnicos  = new Set(pedidos.map(r => `${r['CLIENTE']}-${r['FECHA']}`)).size;

  const porFormaVentas = {};
  pedidosConTotal.forEach(r => { const f = r['FORMA DE PAGO']||'Sin especificar'; porFormaVentas[f] = (porFormaVentas[f]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const tagsFormaVentas = Object.entries(porFormaVentas).sort(([,a],[,b]) => b-a).map(([f,v]) => `<span class="badge badge-teal" style="margin-right:4px">${f}: $${v.toFixed(2)}</span>`).join('') || '<span style="color:var(--muted);font-size:12px">Sin ventas en este período</span>';

  const porProducto = {}; const porRegalia = {};
  pedidos.forEach(r => {
    const nombreProd = r['PRODUCTO']||'';
    if (nombreProd.startsWith('🎁 REGALO:')) {
      const limpio = nombreProd.replace('🎁 REGALO: ','');
      porRegalia[limpio] = (porRegalia[limpio]||0) + (parseFloat(r['CANTIDAD'])||0);
    } else if (nombreProd) {
      if (!porProducto[nombreProd]) porProducto[nombreProd] = { cantidad:0, subtotal:0 };
      porProducto[nombreProd].cantidad += parseFloat(r['CANTIDAD'])||0;
      porProducto[nombreProd].subtotal += parseFloat(r['SUBTOTAL'])||0;
    }
  });
  const filasProducto = Object.entries(porProducto).sort(([,a],[,b]) => b.subtotal-a.subtotal)
    .map(([n,d]) => `<tr><td style="font-weight:600">${escHTML(n)}</td><td style="text-align:right">${d.cantidad%1===0?parseInt(d.cantidad):d.cantidad.toFixed(1)}</td><td style="text-align:right;font-weight:700;color:var(--teal)">$${d.subtotal.toFixed(2)}</td></tr>`).join('')
    || '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Sin productos vendidos</td></tr>';
  const filasRegalia = Object.entries(porRegalia).sort(([,a],[,b]) => b-a)
    .map(([n,c]) => `<tr><td style="font-weight:600">🎁 ${escHTML(n)}</td><td style="text-align:right">${c%1===0?parseInt(c):c.toFixed(1)}</td></tr>`).join('')
    || '<tr><td colspan="2" style="text-align:center;color:var(--muted)">Sin regalías entregadas</td></tr>';

  const filasPedidos = pedidos.slice(0,150).map(r => {
    const total = r['TOTAL PEDIDO ($)'] ? `<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>` : '';
    const pago = r['FORMA DE PAGO'] ? `<span class="badge badge-teal">${r['FORMA DE PAGO']}</span>` : '';
    return `<tr><td style="font-size:12px">${limpiarFecha(r['FECHA'])}</td><td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td><td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td><td style="text-align:center">${r['CANTIDAD']||'-'}</td><td style="text-align:right">${total}</td><td>${pago}</td></tr>`;
  }).join('') || '<tr><td colspan="6"><div class="empty-state"><div class="icon">📋</div>Sin pedidos en este período</div></td></tr>';

  const filasPagos = pagos.map(r => `<tr><td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td><td style="text-align:right;font-weight:700;color:var(--blue)">$${(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td><td>${r['FORMA DE PAGO']?`<span class="badge badge-blue">${r['FORMA DE PAGO']}</span>`:'-'}</td><td style="font-size:12px;color:var(--muted)">${limpiarFecha(r['FECHA'])}</td></tr>`).join('')
    || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sin pagos registrados</td></tr>';
  const filasGastos = gastos.map(r => `<tr><td style="font-weight:600">${escHTML(r['NOTAS']||'-')}</td><td style="text-align:right;font-weight:700;color:var(--red)">$${Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td><td style="font-size:12px;color:var(--muted)">${limpiarFecha(r['FECHA'])}</td></tr>`).join('')
    || '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Sin gastos registrados</td></tr>';

  wrap.innerHTML = `
    <div class="table-card">
      <div class="table-header"><div class="table-title">👤 ${nombre} — Reporte Detallado</div></div>
      <div class="kpi-grid" style="padding:1rem 1.25rem 0">
        <div class="kpi-card teal"><div class="kpi-icon">💰</div><div class="kpi-label">Total ventas</div><div class="kpi-value">$${totalVentas.toFixed(2)}</div><div class="kpi-sub">${pedidosUnicos} pedido(s)</div></div>
        <div class="kpi-card blue"><div class="kpi-icon">💳</div><div class="kpi-label">Total cobrado</div><div class="kpi-value">$${totalCobrado.toFixed(2)}</div><div class="kpi-sub">${pagos.length} pago(s)</div></div>
        <div class="kpi-card red"><div class="kpi-icon">📉</div><div class="kpi-label">Total gastos</div><div class="kpi-value">$${totalGastos.toFixed(2)}</div><div class="kpi-sub">${gastos.length} gasto(s)</div></div>
        <div class="kpi-card orange"><div class="kpi-icon">👥</div><div class="kpi-label">Clientes atendidos</div><div class="kpi-value">${clientesUnicos}</div></div>
        <div class="kpi-card navy"><div class="kpi-icon">🧮</div><div class="kpi-label">Total en caja</div><div class="kpi-value" style="color:${(totalCobrado-totalGastos)>=0?'#0a7c6e':'#c0392b'}">$${(totalCobrado-totalGastos).toFixed(2)}</div></div>
      </div>
      <div class="table-header"><div class="table-title">💳 Formas de pago (ventas)</div></div>
      <div style="padding:0 1.25rem 14px">${tagsFormaVentas}</div>
      <div class="table-header"><div class="table-title">📦 Productos vendidos</div></div>
      <div class="table-wrap"><table><thead><tr><th>Producto</th><th style="text-align:right">Cant.</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${filasProducto}</tbody></table></div>
      <div class="table-header"><div class="table-title">🎁 Regalías entregadas</div></div>
      <div class="table-wrap"><table><thead><tr><th>Regalía</th><th style="text-align:right">Cant.</th></tr></thead><tbody>${filasRegalia}</tbody></table></div>
      <div class="table-header"><div class="table-title">📋 Detalle de pedidos</div></div>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">Total</th><th>Pago</th></tr></thead><tbody>${filasPedidos}</tbody></table></div>
      <div class="table-header"><div class="table-title">💰 Pagos cobrados</div></div>
      <div class="table-wrap"><table><thead><tr><th>Cliente</th><th style="text-align:right">Monto</th><th>Forma</th><th>Fecha</th></tr></thead><tbody>${filasPagos}</tbody></table></div>
      <div class="table-header"><div class="table-title">📉 Gastos registrados</div></div>
      <div class="table-wrap"><table><thead><tr><th>Descripción</th><th style="text-align:right">Monto</th><th>Fecha</th></tr></thead><tbody>${filasGastos}</tbody></table></div>
    </div>`;
}

function limpiarFecha(fecha) {
  if(!fecha) return '-';
  const f=String(fecha);
  if(f.includes('T')) return f.split('T')[0];
  return f;
}

/* ════════════════════════════════════════
   CIERRE DEL DÍA
════════════════════════════════════════ */
const ICONOS_PAGO = { 'Contado':'💵','Crédito':'📋','Transferencia':'🏦','Cheque':'📝','Efectivo':'💵','Sin especificar':'❓' };
const COLORES_PAGO = { 'Contado':'#0a7c6e','Crédito':'#1565c0','Transferencia':'#e67e22','Cheque':'#880e4f','Efectivo':'#0a7c6e','Sin especificar':'#888' };

function abrirCierreDia() {
  const fecha = document.getElementById('filtroFecha').value || fechaHoy();
  const datos = todosLosDatos.filter(r => {
    const f = String(r['FECHA']||'');
    return f.startsWith(fecha) || f.includes(fecha);
  });
  const pedidos = datos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== ''); /* [FIX] antes exigía TOTAL PEDIDO($)>0, lo que excluía todas las líneas de producto extra y TODAS las regalías de un pedido — el total en $ sigue calculándose igual (vía _pedidosVisto), pero ahora las unidades sí suman completas */

  document.getElementById('cierreFechaBadge').textContent = fecha || 'Todos los registros';

  const body = document.getElementById('cierreBody');

  if (!pedidos.length) {
    body.innerHTML = '<div style="padding:3rem;text-align:center;color:var(--muted)"><div style="font-size:2.5rem;margin-bottom:10px">📭</div>No hay pedidos registrados para esta fecha.</div>';
    document.getElementById('cierreOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    return;
  }

  // ── Agrupar por asesor
  const porAsesor = {};
  pedidos.forEach(r => {
    const asesor = r['ASESOR / RUTA'] || 'Sin asignar';
    if (!porAsesor[asesor]) porAsesor[asesor] = { pedidos:[], productos:{}, formasPago:{}, total:0, clientesUnicos:new Set() };
    const d = porAsesor[asesor];
    d.clientesUnicos.add(r['CLIENTE']||'');
    const tot = parseFloat(r['TOTAL PEDIDO ($)']||0);

    // Acumular producto
    const prod = r['PRODUCTO'] || 'Sin nombre';
    if (!d.productos[prod]) d.productos[prod] = { cantidad:0, dolares:0 };
    d.productos[prod].cantidad += parseFloat(r['CANTIDAD']||0);
    d.productos[prod].dolares  += parseFloat(r['SUBTOTAL']||0);

    // Acumular forma de pago — solo 1 vez por pedido único
    const keyPedido = `${r['CLIENTE']}-${r['FECHA']}-${asesor}`;
    if (!d._pedidosVisto) d._pedidosVisto = new Set();
    if (!d._pedidosVisto.has(keyPedido)) {
      d._pedidosVisto.add(keyPedido);
      const forma = r['FORMA DE PAGO'] || 'Sin especificar';
      d.formasPago[forma] = (d.formasPago[forma]||0) + tot;
      d.total += tot;
    }
    d.pedidos.push(r);
  });

  // ── Total general
  let totalGeneral = 0;
  const formasGlobal = {};
  Object.values(porAsesor).forEach(d => {
    totalGeneral += d.total;
    Object.entries(d.formasPago).forEach(([f,v]) => { formasGlobal[f] = (formasGlobal[f]||0) + v; });
  });

  // ── Renderizar bloques por asesor
  let html = '';
  Object.entries(porAsesor).sort(([,a],[,b]) => b.total - a.total).forEach(([asesor, d]) => {
    const color  = RUTA_COLORS[asesor] || '#0a7c6e';
    const nombre = asesor.split(':')[1]?.trim() || asesor;
    const numClientes = d.clientesUnicos.size;
    const numPedidos  = d._pedidosVisto ? d._pedidosVisto.size : 0;

    // Filas productos
    const prodsOrdenados = Object.entries(d.productos).sort(([,a],[,b]) => b.dolares - a.dolares);
    const totalCantidad  = prodsOrdenados.reduce((s,[,p]) => s + p.cantidad, 0);
    const totalDolares   = prodsOrdenados.reduce((s,[,p]) => s + p.dolares, 0);

    const filasProductos = prodsOrdenados.map(([nom,p]) => `
      <tr>
        <td><span style="font-weight:600;color:var(--navy)">${escHTML(nom)}</span></td>
        <td style="font-weight:700;color:var(--blue)">${p.cantidad % 1 === 0 ? parseInt(p.cantidad) : p.cantidad.toFixed(1)}</td>
        <td style="font-weight:700;color:var(--teal)">$${p.dolares.toFixed(2)}</td>
      </tr>`).join('');

    // Tags formas de pago del asesor
    const tagsPago = Object.entries(d.formasPago).sort(([,a],[,b]) => b-a).map(([f,v]) => `
      <div class="cierre-pago-tag">
        <span>${ICONOS_PAGO[f]||'💳'}</span>
        <span>${f}</span>
        <span class="cierre-pago-tag-valor">$${v.toFixed(2)}</span>
      </div>`).join('');

    // ── Detalle por cliente (todos los productos con precios, agrupados por cliente)
    const porCliente = {};
    d.pedidos.forEach(r => {
      const cliente = r['CLIENTE'] || 'Sin nombre';
      if (!porCliente[cliente]) porCliente[cliente] = { items: [], hora: '', formaPago: '' };
      porCliente[cliente].items.push(r);
      if (r['HORA REGISTRO']) porCliente[cliente].hora = r['HORA REGISTRO'];
      if (r['FORMA DE PAGO']) porCliente[cliente].formaPago = r['FORMA DE PAGO'];
    });

    const clientesOrdenados = Object.entries(porCliente).sort(([,a],[,b]) => (a.hora||'').localeCompare(b.hora||''));

    const clientesHtml = clientesOrdenados.map(([clienteRaw, c]) => { const cliente = escHTML(clienteRaw);
      const totalesPedido = c.items.map(r => parseFloat(r['TOTAL PEDIDO ($)']||0)).filter(v => v > 0);
      const totalCliente = totalesPedido.length ? totalesPedido[0] : c.items.reduce((s,r) => s + (parseFloat(r['SUBTOTAL']||0)), 0);

      const filasProdCliente = c.items.map(r => `
        <tr>
          <td>${escHTML(r['PRODUCTO']||'-')}</td>
          <td>$${parseFloat(r['PRECIO UNIT.']||0).toFixed(2)}</td>
          <td>${r['CANTIDAD']||'-'}</td>
          <td>$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
        </tr>`).join('');

      return `
        <div class="cierre-cliente-block">
          <div class="cierre-cliente-header">
            <span class="cierre-cliente-nombre">👤 ${cliente}</span>
            <span class="cierre-cliente-meta">${c.hora?'🕐 '+c.hora+'  ·  ':''}${ICONOS_PAGO[c.formaPago]||'💳'} ${c.formaPago||'Sin especificar'}</span>
            <span class="cierre-cliente-total">$${totalCliente.toFixed(2)}</span>
          </div>
          <table class="cierre-cliente-table">
            <thead><tr><th>Producto</th><th>Precio Unit.</th><th>Cant.</th><th>Subtotal</th></tr></thead>
            <tbody>${filasProdCliente}</tbody>
          </table>
        </div>`;
    }).join('');

    html += `
      <div class="cierre-asesor-block">
        <div class="cierre-asesor-header" style="background:${color}">
          <div class="cierre-asesor-nombre">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="white" stroke-width="1.4"/><path d="M2 14c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="white" stroke-width="1.4" stroke-linecap="round"/></svg>
            ${nombre}
            <span style="font-size:10px;font-weight:500;opacity:0.6;text-transform:uppercase;letter-spacing:0.06em">${asesor.includes('RUTA') ? asesor.split(':')[0].trim() : ''}</span>
            <span style="font-size:11px;font-weight:600;opacity:0.75;margin-left:4px">${numClientes} cliente${numClientes!==1?'s':''} · ${numPedidos} pedido${numPedidos!==1?'s':''}</span>
          </div>
          <div class="cierre-asesor-total">$${d.total.toFixed(2)}</div>
        </div>

        <div class="cierre-section-label">📦 Productos vendidos (resumen)</div>
        <table class="cierre-prod-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Total ($)</th>
            </tr>
          </thead>
          <tbody>
            ${filasProductos}
            <tr class="cierre-prod-subtotal">
              <td style="font-weight:800">SUBTOTAL ASESOR</td>
              <td style="font-weight:800;text-align:right;color:var(--blue)">${totalCantidad % 1 === 0 ? parseInt(totalCantidad) : totalCantidad.toFixed(1)}</td>
              <td style="font-weight:800;text-align:right;color:var(--teal)">$${totalDolares.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div class="cierre-section-label">👥 Detalle por cliente</div>
        ${clientesHtml}

        <div class="cierre-section-label">💳 Formas de pago</div>
        <div class="cierre-pago-tags">${tagsPago}</div>
      </div>`;
  });

  // ── Resumen global de formas de pago
  const tagsGlobal = Object.entries(formasGlobal).sort(([,a],[,b]) => b-a).map(([f,v]) => `
    <div class="cierre-pago-tag" style="border-color:var(--teal);background:var(--teal-light)">
      <span>${ICONOS_PAGO[f]||'💳'}</span>
      <span style="color:var(--teal-dark)">${f}</span>
      <span class="cierre-pago-tag-valor" style="font-size:14px">$${v.toFixed(2)}</span>
    </div>`).join('');

  html += `
    <div class="cierre-resumen-pagos-global">
      <div class="cierre-resumen-pagos-title">💳 Resumen global de formas de pago</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${tagsGlobal}</div>
    </div>
    <div class="cierre-total-general">
      <div>
        <div class="cierre-total-label">Total general del día</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px">${pedidos.length} líneas · ${Object.keys(porAsesor).length} asesor${Object.keys(porAsesor).length!==1?'es':''}</div>
      </div>
      <div class="cierre-total-value">$${totalGeneral.toFixed(2)}</div>
    </div>`;

  // [NEW] Cuadre de Caja del día — Ingresos (pagos) vs Egresos (gastos)
  const pagosCierre  = datos.filter(r => !r['PRODUCTO'] && r['TOTAL PEDIDO ($)'] > 0 && String(r['TOTAL PEDIDO ($)']).indexOf('-') === -1);
  const gastosCierre = datos.filter(r => String(r['TOTAL PEDIDO ($)']).indexOf('-') !== -1);
  const totalIngresosCierre = pagosCierre.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalEgresosCierre  = gastosCierre.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const netoCierre = totalIngresosCierre - totalEgresosCierre;
  html += `
    <div class="cierre-resumen-pagos-global" style="margin-top:1rem">
      <div class="cierre-resumen-pagos-title">🧮 Cuadre de Caja del día</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div style="flex:1;min-width:150px;background:var(--teal-light);border:1.5px solid var(--success-border,#4ec9a0);border-radius:var(--radius);padding:12px 16px">
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--teal-dark)">🟢 Ingresos (pagos)</div>
          <div style="font-family:'DM Serif Display',serif;font-size:1.4rem;color:var(--teal-dark)">$${totalIngresosCierre.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--muted)">${pagosCierre.length} pago(s)</div>
        </div>
        <div style="flex:1;min-width:150px;background:#fdecea;border:1.5px solid #e57373;border-radius:var(--radius);padding:12px 16px">
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--red)">🔴 Egresos (gastos)</div>
          <div style="font-family:'DM Serif Display',serif;font-size:1.4rem;color:var(--red)">$${totalEgresosCierre.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--muted)">${gastosCierre.length} gasto(s)</div>
        </div>
      </div>
    </div>
    <div class="cierre-total-general" style="background:${netoCierre>=0?'var(--navy)':'#7a2020'}">
      <div>
        <div class="cierre-total-label">🧮 Total en caja (Ingresos − Egresos)</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px">Pagos y gastos registrados este día — no incluye ventas a crédito sin cobrar</div>
      </div>
      <div class="cierre-total-value">$${netoCierre.toFixed(2)}</div>
    </div>`;

  body.innerHTML = html;
  document.getElementById('cierreOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarCierreDia() {
  document.getElementById('cierreOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function imprimirCierre() {
  const fecha  = document.getElementById('cierreFechaBadge').textContent;
  const cuerpo = document.getElementById('cierreBody').innerHTML;
  const v = window.open('','_blank','width=800,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cierre del Día — Luan Aqua — ${fecha}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .cierre-asesor-block{border:1.5px solid #ddd;border-radius:12px;overflow:hidden;margin-bottom:20px;page-break-inside:avoid;}
    .cierre-asesor-header{padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;}
    .cierre-asesor-nombre{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#fff;}
    .cierre-asesor-total{font-family:'DM Serif Display',serif;font-size:1.3rem;color:#4ec9a0;}
    .cierre-section-label{font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#888;padding:8px 16px 4px;border-bottom:1px solid #eee;background:#f8f8f8;}
    .cierre-prod-table{width:100%;border-collapse:collapse;font-size:12px;}
    .cierre-prod-table th{background:#f0f5f8;padding:7px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;}
    .cierre-prod-table th:nth-child(2),.cierre-prod-table th:nth-child(3){text-align:right;}
    .cierre-prod-table td{padding:9px 14px;border-bottom:1px solid #f0f0f0;font-weight:500;}
    .cierre-prod-table td:nth-child(2),.cierre-prod-table td:nth-child(3){text-align:right;}
    .cierre-prod-subtotal td{background:#e6f4f2!important;font-weight:800;color:#085f54;border-top:2px solid #0a7c6e!important;}
    .cierre-pago-tags{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;border-top:1px solid #eee;}
    .cierre-pago-tag{display:flex;align-items:center;gap:6px;background:#f0f5f8;border:1.5px solid #ddd;border-radius:100px;padding:5px 14px;font-size:12px;font-weight:700;color:#1a3a5c;}
    .cierre-pago-tag-valor{color:#0a7c6e;font-size:13px;margin-left:2px;}
    .cierre-resumen-pagos-global{background:#f0f5f8;border:1.5px solid #ddd;border-radius:12px;padding:14px 16px;margin-top:16px;}
    .cierre-resumen-pagos-title{font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#0a7c6e;margin-bottom:10px;}
    .cierre-total-general{background:#1a3a5c;border-radius:12px;padding:16px 20px;margin-top:16px;display:flex;align-items:center;justify-content:space-between;}
    .cierre-total-label{font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);}
    .cierre-total-value{font-family:'DM Serif Display',serif;font-size:2rem;color:#4ec9a0;}
    .cierre-cliente-block{border:1px solid #ddd;border-radius:10px;overflow:hidden;margin:8px 16px;page-break-inside:avoid;}
    .cierre-cliente-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 12px;background:#f0f5f8;border-bottom:1px solid #eee;}
    .cierre-cliente-nombre{font-size:12.5px;font-weight:800;color:#1a3a5c;}
    .cierre-cliente-meta{font-size:10.5px;color:#888;font-weight:600;}
    .cierre-cliente-total{font-size:13px;font-weight:800;color:#0a7c6e;}
    .cierre-cliente-table{width:100%;border-collapse:collapse;font-size:11.5px;}
    .cierre-cliente-table th{padding:5px 12px;text-align:left;font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;}
    .cierre-cliente-table th:nth-child(2),.cierre-cliente-table th:nth-child(3),.cierre-cliente-table th:nth-child(4){text-align:right;}
    .cierre-cliente-table td{padding:6px 12px;border-bottom:1px solid #f5f5f5;font-weight:500;}
    .cierre-cliente-table td:nth-child(2),.cierre-cliente-table td:nth-child(3),.cierre-cliente-table td:nth-child(4){text-align:right;}
    .print-header{text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:24px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    .btn-cerrar-cierre,.btn-print-cierre{display:none!important;}
    @media print{body{padding:16px;} .cierre-asesor-block{page-break-inside:avoid;}}
  </style></head><body>
  <div class="print-header"><h1>📅 Cierre del Día — Luan Aqua</h1><p>Fecha: ${fecha} · Generado: ${new Date().toLocaleString('es-EC')}</p></div>
  ${cuerpo}
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  v.document.close();
}

/* [NEW] Exportar Pagos registrados a PDF */
function exportarPagosPDF() {
  const datos = pagosDetalleActuales || [];
  if (!datos.length) { alert('No hay pagos para exportar. Aplica los filtros primero.'); return; }
  const fecha = document.getElementById('filtroFecha').value || 'Todos los registros';
  const total = datos.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const porForma = {};
  datos.forEach(r => { const f = r['FORMA DE PAGO'] || 'Sin especificar'; porForma[f] = (porForma[f]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const resumenForma = Object.entries(porForma).sort(([,a],[,b]) => b-a).map(([f,v]) => `<span style="display:inline-block;background:#e8f0fd;border-radius:100px;padding:5px 14px;font-size:11px;font-weight:700;color:#0d47a1;margin:2px">${f}: $${v.toFixed(2)}</span>`).join('');
  const filas = datos.map(r => `<tr>
    <td>${escHTML(r['CLIENTE']||'-')}</td>
    <td>${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
    <td>${r['FORMA DE PAGO']||'-'}</td>
    <td>${limpiarFecha(r['FECHA'])}</td>
    <td style="text-align:right">$${(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td>
  </tr>`).join('');
  const v = window.open('', '_blank', 'width=900,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Pagos Registrados — Luan Aqua — ${fecha}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:22px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    .resumen-forma{text-align:center;margin-bottom:20px;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    thead tr{background:#1565c0;}
    thead th{padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#fff;}
    thead th:last-child{text-align:right}
    tbody td{padding:9px 12px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
    .total-row{background:#e8f0fd;font-weight:800;color:#0d47a1;}
    .total-row td{padding:12px;border-top:2px solid #1565c0;}
    @media print{body{padding:12px;} thead{display:table-header-group;}}
  </style></head><body>
  <div class="print-header">
    <h1>💰 Pagos Registrados — Luan Aqua</h1>
    <p>Fecha: ${fecha} · ${datos.length} pago(s) · Generado: ${new Date().toLocaleString('es-EC')}</p>
  </div>
  <div class="resumen-forma">${resumenForma}</div>
  <table>
    <thead><tr><th>Cliente</th><th>Asesor</th><th>Forma de Pago</th><th>Fecha</th><th>Monto</th></tr></thead>
    <tbody>
      ${filas}
      <tr class="total-row"><td colspan="4" style="text-align:right">TOTAL PAGOS</td><td style="text-align:right">$${total.toFixed(2)}</td></tr>
    </tbody>
  </table>
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  v.document.close();
}

/* [NEW] Exportar Gastos registrados a PDF */
function exportarGastosPDF() {
  const datos = gastosDetalleActuales || [];
  if (!datos.length) { alert('No hay gastos para exportar. Aplica los filtros primero.'); return; }
  const fecha = document.getElementById('filtroFecha').value || 'Todos los registros';
  const total = datos.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const filas = datos.map(r => {
    const desc = r['NOTAS'] || r['CLIENTE'] || r['DIRECCIÓN'] || '-';
    return `<tr>
      <td>${escHTML(desc)}</td>
      <td>${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
      <td>${limpiarFecha(r['FECHA'])}</td>
      <td style="text-align:right">$${Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td>
    </tr>`;
  }).join('');
  const v = window.open('', '_blank', 'width=900,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Gastos Registrados — Luan Aqua — ${fecha}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:22px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    thead tr{background:#c0392b;}
    thead th{padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#fff;}
    thead th:last-child{text-align:right}
    tbody td{padding:9px 12px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
    .total-row{background:#fdecea;font-weight:800;color:#a93226;}
    .total-row td{padding:12px;border-top:2px solid #c0392b;}
    @media print{body{padding:12px;} thead{display:table-header-group;}}
  </style></head><body>
  <div class="print-header">
    <h1>📉 Gastos Registrados — Luan Aqua</h1>
    <p>Fecha: ${fecha} · ${datos.length} gasto(s) · Generado: ${new Date().toLocaleString('es-EC')}</p>
  </div>
  <table>
    <thead><tr><th>Descripción</th><th>Responsable</th><th>Fecha</th><th>Monto</th></tr></thead>
    <tbody>
      ${filas}
      <tr class="total-row"><td colspan="3" style="text-align:right">TOTAL GASTOS</td><td style="text-align:right">$${total.toFixed(2)}</td></tr>
    </tbody>
  </table>
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  v.document.close();
}

function exportarDetallePDF() {
  const datos = pedidosDetalleActuales;
  if (!datos.length) { alert('No hay datos para exportar. Aplica los filtros primero.'); return; }
  const fecha = document.getElementById('filtroFecha').value || 'Todos los registros';
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const asesorLabel = asesorSel.split(':')[1]?.trim() || 'Todos';

  const totalGeneral = datos.filter(r=>r['TOTAL PEDIDO ($)']&&parseFloat(r['TOTAL PEDIDO ($)'])>0).reduce((s,r)=>s+(parseFloat(r['TOTAL PEDIDO ($)'])||0),0);

  const filas = datos.map(r => {
    const total = r['TOTAL PEDIDO ($)'] ? `$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}` : '—';
    return `<tr>
      <td>${limpiarFecha(r['FECHA'])}</td>
      <td>${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
      <td>${escHTML(r['CLIENTE']||'-')}</td>
      <td>${escHTML(r['TELÉFONO']||'-')}</td>
      <td>${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:center">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
      <td style="text-align:right;font-weight:700">${total}</td>
      <td>${r['FORMA DE PAGO']||'-'}</td>
    </tr>`;
  }).join('');

  const v = window.open('', '_blank', 'width=1000,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Detalle de Pedidos — Luan Aqua — ${fecha}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:22px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    table{width:100%;border-collapse:collapse;font-size:11px;}
    thead tr{background:#1a3a5c;}
    thead th{padding:8px 10px;text-align:left;font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#fff;}
    tbody td{padding:7px 10px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
    .total-row{background:#e6f4f2;font-weight:800;color:#085f54;}
    .total-row td{padding:10px;border-top:2px solid #0a7c6e;}
    @media print{body{padding:12px;} thead{display:table-header-group;}}
  </style></head><body>
  <div class="print-header">
    <h1>📋 Detalle de Pedidos — Luan Aqua</h1>
    <p>Fecha: ${fecha} · Asesor: ${asesorLabel} · ${datos.length} línea(s) · Generado: ${new Date().toLocaleString('es-EC')}</p>
  </div>
  <table>
    <thead><tr><th>Fecha</th><th>Asesor</th><th>Cliente</th><th>Teléfono</th><th>Producto</th><th>Cant.</th><th>Subtotal</th><th>Total</th><th>Pago</th></tr></thead>
    <tbody>
      ${filas}
      <tr class="total-row"><td colspan="7" style="text-align:right">TOTAL GENERAL</td><td style="text-align:right">$${totalGeneral.toFixed(2)}</td><td></td></tr>
    </tbody>
  </table>
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  v.document.close();
}

function exportarExcel() {
  const datos=datosNotasFiltrados.length>0?datosNotasFiltrados:todosLosDatos.filter(r=>r['PRODUCTO']&&r['PRODUCTO']!=='');
  if(!datos.length){ alert('No hay datos para exportar. Aplica los filtros primero.'); return; }
  const headers=['ASESOR / RUTA','CLIENTE','PRODUCTO','PRECIO UNIT.','CANTIDAD','SUBTOTAL','TOTAL PEDIDO ($)','FORMA DE PAGO','FECHA','TELÉFONO','DIRECCIÓN'];
  const filas=datos.map(r=>headers.map(h=>{ const str=String(r[h]!==undefined?r[h]:'').replace(/"/g,'""'); return str.includes(',')||str.includes('"')||str.includes('\n')?`"${str}"`:str; }).join(','));
  const csv='\uFEFF'+headers.join(',')+'\n'+filas.join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const fecha=document.getElementById('notasFecha').value||new Date().toISOString().split('T')[0];
  const asesor=document.getElementById('notasAsesor').value.split(':')[1]?.trim()||'Todos';
  a.href=url; a.download=`NotasVentas_${fecha}_${asesor}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ════════════════════════════════════════════════════════════
   [NEW] EDITAR PEDIDO — solo visible/usable por el Administrador
   (todo dashboard.html ya está protegido por el login que exige
   esAdmin === true, así que llegar hasta aquí ya implica ser admin)
════════════════════════════════════════════════════════════ */
const FORMAS_PAGO_FIJAS = ['Contado','Crédito','Transferencia','Cheque'];

function abrirEditarPedido(pedidoId){
  const p = _pedidosRaw.find(x => x._id === pedidoId);
  if(!p){ alert('No se encontró el pedido — puede que otro admin lo haya eliminado.'); return; }
  // Copia editable e independiente, para no mutar los datos en vivo del listener mientras se edita
  editandoPedidoActual = JSON.parse(JSON.stringify(p));
  editandoPedidoActual._id = pedidoId;
  editandoPedidoActual.productos = (editandoPedidoActual.productos || []).map(prod => ({
    nombre: prod.nombre || '', cantidad: prod.cantidad != null ? prod.cantidad : 1, precio: prod.precio != null ? prod.precio : 0,
    regalias: (prod.regalias || []).map(r => ({ nombre: r.nombre || '', cantidad: r.cantidad != null ? r.cantidad : 1 }))
  }));
  renderModalEditarPedido();
  document.getElementById('editarOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarEditarPedido(){
  document.getElementById('editarOverlay').classList.remove('open');
  document.body.style.overflow = '';
  editandoPedidoActual = null;
}

function _totalCalculadoEdicion(){
  if(!editandoPedidoActual) return 0;
  return editandoPedidoActual.productos.reduce((s,prod) => s + ((parseFloat(prod.cantidad)||0) * (parseFloat(prod.precio)||0)), 0);
}

function renderModalEditarPedido(){
  const p = editandoPedidoActual;
  if(!p) return;

  const optionsAsesor = _asesoresCache.map(r => `<option value="${r}" ${p.empleado===r?'selected':''}>${r.split(':')[1]?.trim()||r}</option>`).join('');
  const optionsPago = FORMAS_PAGO_FIJAS.map(f => `<option value="${f}" ${p.formapago===f?'selected':''}>${f}</option>`).join('');

  document.getElementById('editarBody').innerHTML = `
    <div class="editar-seccion-label">📋 Datos del pedido</div>
    <div class="editar-grid">
      <div class="editar-field"><label>Fecha</label><input type="date" id="editFecha" value="${p.fecha||''}"></div>
      <div class="editar-field"><label>Asesor</label><select id="editAsesor">${optionsAsesor}</select></div>
      <div class="editar-field"><label>Forma de Pago</label><select id="editFormaPago">${optionsPago}</select></div>
      <div class="editar-field"><label>Cliente</label><input type="text" id="editCliente" value="${escapeAttr(p.cliente||'')}"></div>
      <div class="editar-field"><label>Teléfono</label><input type="text" id="editTelefono" value="${escapeAttr(p.telefono||'')}"></div>
      <div class="editar-field"><label>Dirección</label><input type="text" id="editDireccion" value="${escapeAttr(p.direccion||'')}"></div>
    </div>
    <div class="editar-grid full" style="margin-top:10px">
      <div class="editar-field"><label>Notas</label><textarea id="editNotas">${escHTML(p.notas||'')}</textarea></div>
    </div>

    <div class="editar-seccion-label">📦 Productos del pedido</div>
    <div id="editProductosWrap"></div>
    <button type="button" class="btn-agregar-linea" onclick="agregarProductoLinea()">+ Agregar producto</button>

    <div class="editar-total-box">
      <span class="lbl">🧮 Total del pedido (recalculado automáticamente)</span>
      <span class="val" id="editTotalCalculado">$${_totalCalculadoEdicion().toFixed(2)}</span>
    </div>

    <div class="editar-seccion-label">📍 Información de registro (solo lectura)</div>
    <div class="editar-readonly-box">
      <div>Latitud: <b>${(p.gps && p.gps.lat!=null) ? p.gps.lat : '—'}</b></div>
      <div>Longitud: <b>${(p.gps && p.gps.lng!=null) ? p.gps.lng : '—'}</b></div>
      <div>Precisión GPS: <b>${(p.gps && p.gps.acc!=null) ? '±'+p.gps.acc+'m' : '—'}</b></div>
      <div>Hora de registro: <b>${_horaDeTs(p.creadoEn)}</b></div>
      <div style="grid-column:1/-1">Link GPS: ${(p.gps && p.gps.url) ? `<a href="${p.gps.url}" target="_blank" style="color:var(--teal);font-weight:700">📍 Abrir en el mapa</a>` : '<b>—</b>'}</div>
    </div>
  `;
  renderProductosEditor();
}

/* [NEW] Redibuja solo la sección de líneas de producto (y sus regalías) tras cada cambio */
function renderProductosEditor(){
  const wrap = document.getElementById('editProductosWrap');
  if(!wrap || !editandoPedidoActual) return;
  const opcionesProductos = _productosCache.map(prod => `<option value="${escapeAttr(prod.nombre)}">${escHTML(prod.nombre)}</option>`).join('');

  wrap.innerHTML = editandoPedidoActual.productos.map((prod, i) => {
    const subtotal = (parseFloat(prod.cantidad)||0) * (parseFloat(prod.precio)||0);
    const regaliasHtml = (prod.regalias||[]).map((reg, j) => `
      <div class="editar-regalia-row">
        <select onchange="actualizarRegaliaLinea(${i},${j},'nombre',this.value)">
          <option value="">-- Selecciona --</option>
          ${_productosCache.map(pr => `<option value="${escapeAttr(pr.nombre)}" ${reg.nombre===pr.nombre?'selected':''}>${pr.nombre}</option>`).join('')}
        </select>
        <input type="number" min="1" step="1" value="${reg.cantidad}" onchange="actualizarRegaliaLinea(${i},${j},'cantidad',this.value)">
        <button type="button" class="btn-quitar-linea" onclick="eliminarRegaliaLinea(${i},${j})" title="Quitar regalía">✕</button>
      </div>`).join('');

    return `
      <div class="editar-linea-producto">
        <div class="editar-linea-producto-row">
          <div class="editar-field" style="margin-bottom:0">
            <label>Producto</label>
            <select onchange="actualizarProductoLinea(${i},'nombre',this.value)">
              <option value="">-- Selecciona --</option>
              ${_productosCache.map(pr => `<option value="${escapeAttr(pr.nombre)}" ${prod.nombre===pr.nombre?'selected':''}>${pr.nombre}</option>`).join('')}
            </select>
          </div>
          <div class="editar-field" style="margin-bottom:0"><label>Cantidad</label><input type="number" min="1" step="1" value="${prod.cantidad}" onchange="actualizarProductoLinea(${i},'cantidad',this.value)"></div>
          <div class="editar-field" style="margin-bottom:0"><label>Precio Unit. ($)</label><input type="number" min="0" step="0.01" value="${prod.precio}" onchange="actualizarProductoLinea(${i},'precio',this.value)"></div>
          <button type="button" class="btn-quitar-linea" onclick="eliminarProductoLinea(${i})" title="Quitar producto">✕</button>
        </div>
        <div class="editar-linea-subtotal">Subtotal: $${subtotal.toFixed(2)}</div>
        <div class="editar-regalias-box">
          <div class="editar-regalias-label">🎁 Regalías de este producto</div>
          ${regaliasHtml || '<div style="font-size:11px;color:var(--muted)">Sin regalías agregadas</div>'}
          <button type="button" class="btn-agregar-linea" style="margin-top:6px" onclick="agregarRegaliaLinea(${i})">+ Agregar regalía</button>
        </div>
      </div>`;
  }).join('') || '<div style="font-size:12px;color:var(--muted);padding:8px 0">Sin productos. Agrega al menos uno.</div>';

  const totalEl = document.getElementById('editTotalCalculado');
  if(totalEl) totalEl.textContent = '$' + _totalCalculadoEdicion().toFixed(2);
}

function actualizarProductoLinea(i, campo, valor){
  const prod = editandoPedidoActual.productos[i];
  if(!prod) return;
  prod[campo] = (campo==='cantidad'||campo==='precio') ? (parseFloat(valor)||0) : valor;
  renderProductosEditor();
}
function eliminarProductoLinea(i){
  editandoPedidoActual.productos.splice(i,1);
  renderProductosEditor();
}
function agregarProductoLinea(){
  editandoPedidoActual.productos.push({ nombre:'', cantidad:1, precio:0, regalias:[] });
  renderProductosEditor();
}
function actualizarRegaliaLinea(i, j, campo, valor){
  const reg = editandoPedidoActual.productos[i]?.regalias[j];
  if(!reg) return;
  reg[campo] = campo==='cantidad' ? (parseFloat(valor)||1) : valor;
  renderProductosEditor();
}
function eliminarRegaliaLinea(i, j){
  editandoPedidoActual.productos[i].regalias.splice(j,1);
  renderProductosEditor();
}
function agregarRegaliaLinea(i){
  editandoPedidoActual.productos[i].regalias.push({ nombre:'', cantidad:1 });
  renderProductosEditor();
}

/* [NEW] Guarda solo el documento modificado en Firestore (sin volver a consultar toda la
   colección) y registra cada campo que cambió en historialCambios para auditoría. */
async function guardarEdicionPedido(){
  if(!editandoPedidoActual) return;
  const original = _pedidosRaw.find(x => x._id === editandoPedidoActual._id);
  if(!original){ alert('El pedido ya no existe.'); cerrarEditarPedido(); return; }

  const productosLimpios = editandoPedidoActual.productos
    .filter(prod => (prod.nombre||'').trim() !== '')
    .map(prod => {
      const cantidad = parseFloat(prod.cantidad)||0, precio = parseFloat(prod.precio)||0;
      return {
        nombre: prod.nombre.trim(), cantidad, precio, subtotal: +(cantidad*precio).toFixed(2),
        regalias: (prod.regalias||[]).filter(r => (r.nombre||'').trim()!=='').map(r => ({ nombre:r.nombre.trim(), cantidad: parseFloat(r.cantidad)||1 }))
      };
    });

  const cliente = document.getElementById('editCliente').value.trim();
  if(!cliente){ alert('El nombre del cliente no puede quedar vacío.'); return; }
  if(!productosLimpios.length){ alert('El pedido debe tener al menos un producto con nombre.'); return; }

  const nuevo = {
    fecha: document.getElementById('editFecha').value,
    empleado: document.getElementById('editAsesor').value,
    formapago: document.getElementById('editFormaPago').value,
    cliente,
    telefono: document.getElementById('editTelefono').value.trim(),
    direccion: document.getElementById('editDireccion').value.trim(),
    notas: document.getElementById('editNotas').value.trim(),
    productos: productosLimpios,
    total: +productosLimpios.reduce((s,prod) => s + prod.subtotal, 0).toFixed(2)
  };

  // Detectar cambios campo por campo para el historial de auditoría
  const camposSimples = ['fecha','empleado','formapago','cliente','telefono','direccion','notas','total'];
  const cambios = [];
  camposSimples.forEach(c => {
    const antes = original[c] !== undefined ? original[c] : '';
    const despues = nuevo[c] !== undefined ? nuevo[c] : '';
    if (String(antes) !== String(despues)) cambios.push({ campo:c, antes, despues });
  });
  if (JSON.stringify(original.productos||[]) !== JSON.stringify(nuevo.productos)) {
    cambios.push({ campo:'productos', antes: JSON.stringify(original.productos||[]), despues: JSON.stringify(nuevo.productos) });
  }

  const btn = document.getElementById('btnGuardarEdicion');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try{
    // [NEW] Solo se actualiza este documento puntual — no se vuelve a leer ni recorrer toda la colección
    await db.collection('pedidos').doc(editandoPedidoActual._id).update(nuevo);

    if (cambios.length){
      const lote = db.batch();
      cambios.forEach(c => {
        const ref = db.collection('historialCambios').doc();
        lote.set(ref, {
          pedidoId: editandoPedidoActual._id,
          usuarioAdmin: ADMIN_ACTUAL.nombre || ADMIN_ACTUAL.uid || 'admin',
          fecha: fechaHoy(),
          hora: new Date().toLocaleTimeString('es-EC'),
          campo: c.campo,
          valorAnterior: String(c.antes),
          valorNuevo: String(c.despues),
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await lote.commit();
    }

    // El listener en tiempo real de "pedidos" ya activo recibe el cambio y recalcula
    // automáticamente KPIs, gráficos, Resumen por Cliente y Cuadre de Caja — sin recargar.
    mostrarToastEdicion('✅ Pedido actualizado correctamente.');
    cerrarEditarPedido();
  }catch(err){
    console.error(err);
    alert('❌ Ocurrió un error al guardar los cambios: ' + err.message);
  }finally{
    btn.disabled = false; btn.textContent = '✅ Guardar Cambios';
  }
}

/* ════════════════════════════════════════════════════════════
   [NEW] ELIMINAR PEDIDO — con respaldo completo antes de borrar
   El documento original se copia entero a la colección
   `pedidosEliminados` (con fecha, hora y usuario admin que lo
   eliminó) y recién después se borra de `pedidos`. Si algún día
   hace falta, el pedido completo sigue existiendo ahí — nunca se
   pierde información, solo se saca de la vista operativa.
════════════════════════════════════════════════════════════ */
async function eliminarPedidoCompleto(pedidoId){
  const p = _pedidosRaw.find(x => x._id === pedidoId);
  if(!p){ alert('No se encontró el pedido — puede que ya se haya eliminado.'); return; }

  const clienteNombre = p.cliente || 'Sin nombre';
  const totalPedido = p.total != null ? `$${parseFloat(p.total).toFixed(2)}` : '$0.00';
  const confirmado = confirm(`¿Eliminar por completo el pedido de "${clienteNombre}" (${totalPedido})?\n\nEsta acción lo saca del dashboard y de la app de asesores. Queda respaldado en el historial de eliminados, pero ya no aparecerá en ningún reporte activo.`);
  if(!confirmado) return;

  try{
    // 1) Respaldo completo del documento original + metadata de la eliminación
    const { _id, ...datosOriginales } = p; // quita el campo interno _id antes de guardar el respaldo
    await db.collection('pedidosEliminados').doc(pedidoId).set({
      ...datosOriginales,
      pedidoIdOriginal: pedidoId,
      eliminadoPor: ADMIN_ACTUAL.nombre || ADMIN_ACTUAL.uid || 'admin',
      fechaEliminacion: fechaHoy(),
      horaEliminacion: new Date().toLocaleTimeString('es-EC'),
      eliminadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2) Recién ahora se borra el documento original de "pedidos"
    await db.collection('pedidos').doc(pedidoId).delete();

    // El listener en tiempo real ya activo quita el pedido de la tabla, KPIs,
    // Resumen por Cliente y Cuadre de Caja automáticamente — sin recargar.
    mostrarToastEdicion('🗑 Pedido eliminado y respaldado correctamente.');
  }catch(err){
    console.error(err);
    alert('❌ Ocurrió un error al eliminar el pedido: ' + err.message);
  }
}

/* ════════════════════════════════════════════════════════════
   [NEW] VER PEDIDOS ELIMINADOS — tabla de respaldo, con fecha,
   hora y usuario de la eliminación, más todo el detalle original
   del pedido (cliente, productos, regalías, pagos, GPS, notas)
   desplegable con un clic sobre la fila.
════════════════════════════════════════════════════════════ */
function renderTablaEliminados(){
  const tbody = document.getElementById('tablaEliminados');
  const count = document.getElementById('eliminadosCount');
  if(!tbody) return;
  if(count) count.textContent = _eliminadosRaw.length + ' registro' + (_eliminadosRaw.length!==1?'s':'');
  if(!_eliminadosRaw.length){
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="icon">🗑</div>No hay pedidos eliminados registrados</div></td></tr>';
    return;
  }
  tbody.innerHTML = _eliminadosRaw.map((p, idx) => {
    const total = p.total != null ? `<strong style="color:var(--red)">$${parseFloat(p.total).toFixed(2)}</strong>` : '—';
    const pago = p.formapago ? `<span class="badge badge-red">${escHTML(p.formapago)}</span>` : '';
    const asesorNombre = escHTML((p.empleado||'').split(':')[1]?.trim() || p.empleado || '-');

    // Detalle desplegable: productos, regalías, teléfono, dirección, notas, GPS
    const filasProductos = (p.productos||[]).map(prod => {
      let fila = `<tr>
        <td>${escHTML(prod.nombre||'-')}</td>
        <td style="text-align:center">${prod.cantidad!=null?escHTML(String(prod.cantidad)):'-'}</td>
        <td style="text-align:right">$${parseFloat(prod.precio||0).toFixed(2)}</td>
        <td style="text-align:right">$${parseFloat(prod.subtotal||0).toFixed(2)}</td>
      </tr>`;
      if(prod.regalias && prod.regalias.length){
        fila += prod.regalias.map(reg => `<tr><td colspan="2" style="font-size:11px;color:var(--teal-dark);font-style:italic">🎁 Regalo: ${escHTML(reg.nombre||'-')} x${escHTML(String(reg.cantidad||1))}</td><td colspan="2" style="font-size:11px;color:var(--teal-dark);font-style:italic">Regalo</td></tr>`).join('');
      }
      return fila;
    }).join('');
    const gpsInfo = (p.gps && p.gps.url) ? `<a href="${escapeAttr(p.gps.url)}" target="_blank" style="color:var(--teal);font-weight:700">📍 Ver ubicación del pedido</a>` : 'Sin GPS registrado';

    return `<tr>
      <td style="font-size:12px;white-space:nowrap">${limpiarFecha(p.fechaEliminacion)}</td>
      <td style="font-size:12px;white-space:nowrap">${escHTML(p.horaEliminacion||'-')}</td>
      <td style="font-size:12px;font-weight:700;color:var(--navy)">${escHTML(p.eliminadoPor||'-')}</td>
      <td style="font-weight:600">${escHTML(p.cliente||'-')}</td>
      <td style="font-size:12px">${asesorNombre}</td>
      <td style="font-size:12px;color:var(--muted);white-space:nowrap">${limpiarFecha(p.fecha)}</td>
      <td style="text-align:right">${total}</td>
      <td>${pago}</td>
      <td><button class="btn-editar-fila" onclick="toggleEliminadoDetalle(${idx})" id="btnEliminadoToggle-${idx}" title="Ver todo lo que se eliminó">👁 Ver detalle</button></td>
    </tr>
    <tr id="filaEliminadoDetalle-${idx}" style="display:none">
      <td colspan="9" style="background:var(--surface2);padding:14px 18px">
        <div style="font-size:12px;color:var(--muted);line-height:1.9;margin-bottom:10px">
          📞 Teléfono: <b style="color:var(--text)">${escHTML(p.telefono||'-')}</b> &nbsp;·&nbsp;
          📍 Dirección: <b style="color:var(--text)">${escHTML(p.direccion||'-')}</b><br>
          📝 Notas: <b style="color:var(--text)">${escHTML(p.notas||'-')}</b> &nbsp;·&nbsp; ${gpsInfo}
        </div>
        <table class="cierre-cliente-table" style="border:1px solid var(--border);border-radius:8px;overflow:hidden">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
          <tbody>${filasProductos || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sin productos registrados</td></tr>'}</tbody>
        </table>
      </td>
    </tr>`;
  }).join('');
}
function toggleEliminadoDetalle(idx){
  const fila = document.getElementById('filaEliminadoDetalle-'+idx);
  const btn = document.getElementById('btnEliminadoToggle-'+idx);
  if(!fila) return;
  const abrir = fila.style.display === 'none';
  fila.style.display = abrir ? 'table-row' : 'none';
  if(btn) btn.textContent = abrir ? '🙈 Ocultar' : '👁 Ver detalle';
}

/* ════════════════════════════════════════════════════════════
   [NEW] INVENTARIO — entradas y salidas con historial completo
════════════════════════════════════════════════════════════ */
function renderInventario(){
  const sel = document.getElementById('invProducto');
  if (sel) {
    const valorActual = sel.value;
    sel.innerHTML = '<option value="">-- Selecciona --</option>' + _productosCache.map(p => `<option value="${escapeAttrDash(p.nombre)}">${p.nombre}</option>`).join('');
    if (_productosCache.some(p => p.nombre === valorActual)) sel.value = valorActual; /* [FIX] ahora se actualiza siempre, no solo la primera vez, y conserva la selección si sigue existiendo */
  }
  const stock = {};
  _movimientosInvRaw.forEach(m => {
    if (!stock[m.producto]) stock[m.producto] = { entradas: 0, salidas: 0 };
    if (m.tipo === 'entrada') stock[m.producto].entradas += parseFloat(m.cantidad) || 0;
    else stock[m.producto].salidas += parseFloat(m.cantidad) || 0;
  });
  const tbodyStock = document.getElementById('tablaStockActual');
  const entries = Object.entries(stock).sort(([a],[b]) => a.localeCompare(b));
  if (tbodyStock) {
    tbodyStock.innerHTML = entries.length ? entries.map(([nombre,d]) => {
      const actual = d.entradas - d.salidas;
      return `<tr><td style="font-weight:600">${escHTML(nombre)}</td><td style="text-align:right;color:var(--teal)">${d.entradas}</td><td style="text-align:right;color:var(--red)">${d.salidas}</td><td style="text-align:right;font-weight:800;color:${actual<0?'var(--red)':'var(--navy)'}">${actual}</td></tr>`;
    }).join('') : '<tr><td colspan="4"><div class="empty-state"><div class="icon">📦</div>Sin movimientos registrados</div></td></tr>';
  }
  const tbodyMov = document.getElementById('tablaMovimientosInv');
  if (tbodyMov) {
    tbodyMov.innerHTML = _movimientosInvRaw.length ? _movimientosInvRaw.slice(0,150).map(m => {
      const tipoBadge = m.tipo === 'entrada' ? '<span class="badge badge-teal">🟢 Entrada</span>' : '<span class="badge badge-red">🔴 Salida</span>';
      return `<tr><td style="font-size:12px">${limpiarFecha(m.fecha)}</td><td style="font-weight:600">${escHTML(m.producto)}</td><td>${tipoBadge}</td><td style="text-align:right;font-weight:700">${escHTML(String(m.cantidad))}</td><td style="font-size:12px;color:var(--muted)">${escHTML(m.motivo||'-')}</td><td style="font-size:12px">${escHTML(m.usuario||'-')}</td></tr>`;
    }).join('') : '<tr><td colspan="6"><div class="empty-state"><div class="icon">📋</div>Sin historial</div></td></tr>';
  }
}
async function registrarMovimientoInventario(){
  const producto = document.getElementById('invProducto').value;
  const tipo = document.getElementById('invTipo').value;
  const cantidad = parseFloat(document.getElementById('invCantidad').value);
  const fecha = document.getElementById('invFecha').value || fechaHoy();
  const motivo = document.getElementById('invMotivo').value.trim();
  if (!producto) { alert('Selecciona un producto.'); return; }
  if (!cantidad || cantidad <= 0) { alert('Ingresa una cantidad válida.'); return; }
  try {
    await db.collection('inventarioMovimientos').add({
      producto, tipo, cantidad, fecha, motivo,
      usuario: ADMIN_ACTUAL.nombre || ADMIN_ACTUAL.uid || 'admin',
      creadoPor: ADMIN_ACTUAL.uid || null,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('invCantidad').value = '';
    document.getElementById('invMotivo').value = '';
    mostrarToastEdicion('✅ Movimiento de inventario registrado.');
  } catch(err) { console.error(err); alert('❌ No se pudo registrar el movimiento: ' + err.message); }
}
function escapeAttrDash(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
/* [FIX] escapeAttr se había borrado por accidente al reescribir Consultar por Cliente —
   esto rompía TODO lo que la usaba (Consultar por Cliente, Pedidos Eliminados, Editar Pedido, etc.) */
function escapeAttr(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

/* [NEW] Normaliza el texto de Asesor que viene del Excel (ej. "JEFFERSON", "Vicente",
   "jefferson") contra las rutas reales registradas ("RUTA 1: Jefferson", etc.), para que
   el filtro de asesor SIEMPRE encuentre coincidencia exacta después de importar. */
function _matchAsesorCanonico(texto){
  if(!texto) return '';
  const t = texto.toLowerCase().trim();
  let exacto = _asesoresCache.find(r => r.toLowerCase() === t);
  if (exacto) return exacto;
  let porNombre = _asesoresCache.find(r => (r.split(':')[1]||'').trim().toLowerCase() === t);
  if (porNombre) return porNombre;
  let parcial = _asesoresCache.find(r => r.toLowerCase().includes(t) || t.includes((r.split(':')[1]||'').trim().toLowerCase()));
  return parcial || texto; // si no encuentra match, deja el texto original (se ve en la preview)
}

/* [NEW] Migración única — corrige pedidos ya importados cuyo campo 'empleado'
   no coincide exactamente con el formato "RUTA N: Nombre" usado por los filtros. */
async function corregirAsesoresPedidosExistentes(){
  const candidatos = _pedidosRaw.filter(p => p.empleado && !_asesoresCache.includes(p.empleado));
  if(!candidatos.length){ alert('No se encontraron pedidos con asesor mal formateado.'); return; }

  const preview = candidatos.slice(0,15).map(p => `"${p.empleado}" → "${_matchAsesorCanonico(p.empleado)}"`).join('\n');
  if(!confirm(`Se corregirán ${candidatos.length} pedido(s). Ejemplos:\n\n${preview}${candidatos.length>15?'\n...':''}\n\n¿Continuar?`)) return;

  try{
    let lote = db.batch(); let contador = 0;
    for(const p of candidatos){
      const corregido = _matchAsesorCanonico(p.empleado);
      if(corregido !== p.empleado){
        lote.update(db.collection('pedidos').doc(p._id), { empleado: corregido });
        contador++;
        if(contador % 400 === 0){ await lote.commit(); lote = db.batch(); }
      }
    }
    await lote.commit();
    mostrarToastEdicion(`✅ ${contador} pedido(s) corregido(s) correctamente.`);
  }catch(err){ console.error(err); alert('❌ Error al corregir: ' + err.message); }
}

/* ════════════════════════════════════════════════════════════
   [NEW] ROLES DE PAGO — sueldo base + comisión por ventas
   El % de comisión por asesor está en 0 por defecto (aún no hay
   tabla de comisiones); se edita fila por fila y se recuerda para
   los próximos cálculos hasta que definan la tabla oficial.
════════════════════════════════════════════════════════════ */
let _rolesCalculados = [];
function calcularRolesPago(){
  const desde = document.getElementById('rolesDesde').value;
  const hasta = document.getElementById('rolesHasta').value;
  if (!desde || !hasta) { alert('Selecciona el rango de fechas del período.'); return; }
  const pedidosPeriodo = _pedidosRaw.filter(p => p.fecha >= desde && p.fecha <= hasta);
  const ventasPorAsesor = {};
  pedidosPeriodo.forEach(p => { const a = p.empleado || 'Sin asignar'; ventasPorAsesor[a] = (ventasPorAsesor[a]||0) + (parseFloat(p.total)||0); });
  _rolesCalculados = _asesoresCache.map(ruta => {
    const nombre = ruta.split(':')[1]?.trim() || ruta;
    const ventas = ventasPorAsesor[ruta] || 0;
    const existente = _rolesConfig[ruta] || { sueldoBase: 0, comisionPct: 0 };
    const comision = ventas * (existente.comisionPct/100);
    return { ruta, nombre, sueldoBase: existente.sueldoBase, ventas, comisionPct: existente.comisionPct, comision, total: existente.sueldoBase + comision };
  });
  renderTablaRolesPago();
}
function renderTablaRolesPago(){
  const tbody = document.getElementById('tablaRolesPago');
  if (!_rolesCalculados.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">💵</div>Calcula un período para ver los roles</div></td></tr>'; document.getElementById('rolesTotalGeneral').innerHTML = ''; return; }
  let totalGeneral = 0;
  tbody.innerHTML = _rolesCalculados.map((r,i) => {
    totalGeneral += r.total;
    return `<tr>
      <td style="font-weight:600">${r.nombre}</td>
      <td style="text-align:right"><input type="number" min="0" step="0.01" value="${r.sueldoBase}" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;text-align:right" onchange="actualizarRolCampo(${i},'sueldoBase',this.value)"></td>
      <td style="text-align:right;color:var(--teal);font-weight:700">$${r.ventas.toFixed(2)}</td>
      <td style="text-align:right"><input type="number" min="0" max="100" step="0.1" value="${r.comisionPct}" style="width:65px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;text-align:right" onchange="actualizarRolCampo(${i},'comisionPct',this.value)">%</td>
      <td style="text-align:right">$${r.comision.toFixed(2)}</td>
      <td style="text-align:right;font-weight:800;color:var(--navy)">$${r.total.toFixed(2)}</td>
      <td><button class="btn-editar-fila" onclick="guardarRolPago(${i})">💾 Guardar rol</button></td>
    </tr>`;
  }).join('');
  document.getElementById('rolesTotalGeneral').innerHTML = `<div class="editar-total-box"><span class="lbl">Total general del período</span><span class="val">$${totalGeneral.toFixed(2)}</span></div>`;
}
function actualizarRolCampo(i, campo, valor){
  _rolesCalculados[i][campo] = parseFloat(valor) || 0;
  const r = _rolesCalculados[i];
  r.comision = r.ventas * (r.comisionPct/100);
  r.total = r.sueldoBase + r.comision;
  _rolesConfig[r.ruta] = { sueldoBase: r.sueldoBase, comisionPct: r.comisionPct }; // se recuerda para futuros cálculos
  renderTablaRolesPago();
}
async function guardarRolPago(i){
  const r = _rolesCalculados[i];
  const desde = document.getElementById('rolesDesde').value, hasta = document.getElementById('rolesHasta').value;
  try {
    await db.collection('rolesPago').add({
      asesorRuta: r.ruta, asesorNombre: r.nombre, periodoDesde: desde, periodoHasta: hasta,
      sueldoBase: r.sueldoBase, ventasPeriodo: r.ventas, comisionPct: r.comisionPct, comisionCalculada: r.comision, totalPagado: r.total,
      generadoPor: ADMIN_ACTUAL.nombre || 'admin', fechaGeneracion: fechaHoy(),
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    mostrarToastEdicion('✅ Rol de pago guardado para ' + r.nombre + '.');
  } catch(err) { console.error(err); alert('❌ No se pudo guardar el rol: ' + err.message); }
}

/* ════════════════════════════════════════════════════════════
   [NEW] IMPORTAR DATOS — pedidos históricos desde Excel/CSV
   Cada fila = un producto; filas con el mismo Cliente+Fecha+Asesor
   se agrupan en un solo pedido, igual que hace el resto del dashboard.
════════════════════════════════════════════════════════════ */
let _pedidosParaImportar = [];
function procesarArchivoImportado(){
  const input = document.getElementById('importarArchivo');
  const file = input.files[0];
  if (!file) { alert('Selecciona un archivo primero.'); return; }
  const reader = new FileReader();
  reader.onload = function(e){
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(ws, { defval: '' });
      agruparYPrevisualizarImportacion(filas);
    } catch(err) { console.error(err); alert('No se pudo leer el archivo. Verifica que sea un Excel o CSV válido.'); }
  };
  reader.readAsArrayBuffer(file);
}
/* [FIX] Antes esto solo reconocía encabezados con capitalización exacta ('Fecha' o
   'fecha'), así que un Excel con encabezados en MAYÚSCULAS ('FECHA') o con espacios
   ('FORMA DE PAGO') no coincidía con nada y todas las filas se descartaban -- por eso
   no aparecía ningún pedido al importar. Ahora normaliza encabezados (mayúsculas, sin
   tildes, sin espacios) antes de buscarlos, así que funciona sin importar cómo estén
   escritos en el archivo. */
function _normEncabezado(s){
  return String(s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
}
function _valorColumna(filaNormalizada, aliases){
  for (const alias of aliases){
    const v = filaNormalizada[_normEncabezado(alias)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}
function agruparYPrevisualizarImportacion(filas){
  const grupos = {};
  filas.forEach(f => {
    const filaNorm = {};
    Object.keys(f).forEach(k => { filaNorm[_normEncabezado(k)] = f[k]; });
    const fecha = _valorColumna(filaNorm, ['Fecha']);
    const asesor = _matchAsesorCanonico(_valorColumna(filaNorm, ['Asesor']));
    const cliente = _valorColumna(filaNorm, ['Cliente']);
    if (!fecha || !cliente) return;
    const key = `${cliente}|${fecha}|${asesor}`;
    if (!grupos[key]) grupos[key] = { fecha, empleado: asesor, cliente, telefono: _valorColumna(filaNorm, ['Telefono']), direccion: _valorColumna(filaNorm, ['Direccion']), formapago: _valorColumna(filaNorm, ['FormaPago','Forma de Pago']) || 'Contado', notas: _valorColumna(filaNorm, ['Notas']), productos: [] };
    const cantidad = parseFloat(_valorColumna(filaNorm, ['Cantidad'])) || 0;
    const precio = parseFloat(_valorColumna(filaNorm, ['Precio'])) || 0;
    grupos[key].productos.push({ nombre: _valorColumna(filaNorm, ['Producto']), cantidad, precio, subtotal: +(cantidad*precio).toFixed(2), regalias: [] });
  });
  _pedidosParaImportar = Object.values(grupos).map(p => ({ ...p, total: +p.productos.reduce((s,pr) => s+pr.subtotal, 0).toFixed(2) }));
  renderPreviewImportacion();
}
function renderPreviewImportacion(){
  const cont = document.getElementById('importarPreview');
  if (!_pedidosParaImportar.length) { cont.innerHTML = '<div class="empty-state"><div class="icon">📭</div>No se detectaron pedidos válidos en el archivo. Revisa que las columnas coincidan con el formato indicado arriba.</div>'; return; }
  const filas = _pedidosParaImportar.map(p => `<tr><td style="font-size:12px">${escHTML(p.fecha)}</td><td style="font-size:12px">${escHTML(p.empleado||'-')}</td><td style="font-weight:600">${escHTML(p.cliente)}</td><td style="text-align:center">${p.productos.length}</td><td style="text-align:right;font-weight:700;color:var(--teal)">$${p.total.toFixed(2)}</td></tr>`).join('');
  cont.innerHTML = `
    <div style="margin-bottom:10px;font-size:13px;font-weight:700;color:var(--navy)">Se detectaron ${_pedidosParaImportar.length} pedido(s) — revisa antes de confirmar:</div>
    <div class="table-wrap" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:320px;overflow-y:auto">
      <table><thead><tr><th>Fecha</th><th>Asesor</th><th>Cliente</th><th style="text-align:center">Prod.</th><th style="text-align:right">Total</th></tr></thead><tbody>${filas}</tbody></table>
    </div>
    <button class="btn-filter" id="btnConfirmarImportacion" style="background:var(--red);margin-top:14px" onclick="confirmarImportacionMasiva()">⬆ Confirmar e importar ${_pedidosParaImportar.length} pedido(s) a Firestore</button>
  `;
}
async function confirmarImportacionMasiva(){
  if (!_pedidosParaImportar.length) return;
  if (!confirm(`¿Importar ${_pedidosParaImportar.length} pedido(s) a la base de datos activa? Cada pedido importado queda marcado como "importado:true" para poder identificarlo y eliminarlo individualmente después si hace falta.`)) return;
  const btn = document.getElementById('btnConfirmarImportacion');
  if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }
  try {
    let lote = db.batch(); let contador = 0;
    for (const p of _pedidosParaImportar) {
      const ref = db.collection('pedidos').doc();
      lote.set(ref, { ...p, importado: true, creadoPor: ADMIN_ACTUAL.uid || null, creadoEn: firebase.firestore.FieldValue.serverTimestamp() });
      contador++;
      if (contador % 400 === 0) { await lote.commit(); lote = db.batch(); } // límite de Firestore: 500 operaciones por lote
    }
    await lote.commit();
    mostrarToastEdicion(`✅ ${_pedidosParaImportar.length} pedido(s) importado(s) correctamente.`);
    _pedidosParaImportar = [];
    document.getElementById('importarPreview').innerHTML = '';
    document.getElementById('importarArchivo').value = '';
  } catch(err) { console.error(err); alert('❌ Error al importar: ' + err.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '⬆ Confirmar e importar'; } }
}

/* [NEW] Notificación flotante simple, reutilizable */
function mostrarToastEdicion(msg){
  let t = document.getElementById('toastEdicion');
  if(!t){
    t = document.createElement('div');
    t.id = 'toastEdicion';
    t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--navy);color:#fff;padding:12px 22px;border-radius:100px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;box-shadow:var(--shadow-lg);z-index:999;opacity:0;transition:opacity .25s;pointer-events:none";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(window._toastEdicionTimer);
  window._toastEdicionTimer = setTimeout(()=>{ t.style.opacity = '0'; }, 2600);
}

/* ════════════════════════════════════════════════════════════
   [NEW] EDITAR / ELIMINAR PAGO Y GASTO — Cuadre de Caja (solo Admin)
════════════════════════════════════════════════════════════ */
const FORMAS_PAGO_COBRO = ['Efectivo','Transferencia','Cheque']; // mismas opciones que usa index.html al registrar un pago
let _editandoPagoGasto = null; // { tipo:'pago'|'gasto', id:'...' }

function abrirEditarPago(id){
  const p = _pagosRaw.find(x => x._id === id);
  if(!p){ alert('No se encontró el pago — puede que ya se haya eliminado.'); return; }
  _editandoPagoGasto = { tipo:'pago', id };
  document.getElementById('editarPagoGastoTitulo').textContent = '✏ Editar Pago';
  const optionsForma = FORMAS_PAGO_COBRO.map(f => `<option value="${f}" ${p.forma===f?'selected':''}>${f}</option>`).join('');
  document.getElementById('editarPagoGastoBody').innerHTML = `
    <div class="editar-grid full">
      <div class="editar-field"><label>Cliente</label><input type="text" id="epgCliente" value="${escapeAttr(p.cliente||'')}"></div>
      <div class="editar-field"><label>Monto ($)</label><input type="number" min="0" step="0.01" id="epgMonto" value="${parseFloat(p.monto)||0}"></div>
      <div class="editar-field"><label>Forma de Pago</label><select id="epgForma">${optionsForma}</select></div>
      <div class="editar-field"><label>Fecha</label><input type="date" id="epgFecha" value="${p.fecha||''}"></div>
      <div class="editar-field"><label>Notas / Referencia</label><textarea id="epgNotas">${escHTML(p.notas||'')}</textarea></div>
    </div>`;
  document.getElementById('editarPagoGastoOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function abrirEditarGasto(id){
  const g = _gastosRaw.find(x => x._id === id);
  if(!g){ alert('No se encontró el gasto — puede que ya se haya eliminado.'); return; }
  _editandoPagoGasto = { tipo:'gasto', id };
  document.getElementById('editarPagoGastoTitulo').textContent = '✏ Editar Gasto';
  document.getElementById('editarPagoGastoBody').innerHTML = `
    <div class="editar-grid full">
      <div class="editar-field"><label>Descripción</label><input type="text" id="epgDesc" value="${escapeAttr(g.desc||'')}"></div>
      <div class="editar-field"><label>Categoría</label><input type="text" id="epgCategoria" value="${escapeAttr(g.categoria||'')}"></div>
      <div class="editar-field"><label>Monto ($)</label><input type="number" min="0" step="0.01" id="epgMonto" value="${parseFloat(g.monto)||0}"></div>
      <div class="editar-field"><label>Fecha</label><input type="date" id="epgFecha" value="${g.fecha||''}"></div>
      <div class="editar-field"><label>Comprobante / Referencia</label><input type="text" id="epgRef" value="${escapeAttr(g.ref||'')}"></div>
    </div>`;
  document.getElementById('editarPagoGastoOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarEditarPagoGasto(){
  document.getElementById('editarPagoGastoOverlay').classList.remove('open');
  document.body.style.overflow = '';
  _editandoPagoGasto = null;
}

async function guardarEdicionPagoGasto(){
  if(!_editandoPagoGasto) return;
  const { tipo, id } = _editandoPagoGasto;
  const monto = parseFloat(document.getElementById('epgMonto').value);
  if(!monto || monto <= 0){ alert('Ingresa un monto válido mayor a $0.'); return; }
  const btn = document.getElementById('btnGuardarPagoGasto');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try{
    if(tipo === 'pago'){
      const cliente = document.getElementById('epgCliente').value.trim();
      if(!cliente){ alert('El nombre del cliente no puede quedar vacío.'); btn.disabled=false; btn.textContent='✅ Guardar Cambios'; return; }
      await db.collection('pagos').doc(id).update({
        cliente, monto, forma: document.getElementById('epgForma').value,
        fecha: document.getElementById('epgFecha').value, notas: document.getElementById('epgNotas').value.trim()
      });
    } else {
      const desc = document.getElementById('epgDesc').value.trim();
      if(!desc){ alert('La descripción no puede quedar vacía.'); btn.disabled=false; btn.textContent='✅ Guardar Cambios'; return; }
      await db.collection('gastos').doc(id).update({
        desc, categoria: document.getElementById('epgCategoria').value.trim(), monto,
        fecha: document.getElementById('epgFecha').value, ref: document.getElementById('epgRef').value.trim()
      });
    }
    mostrarToastEdicion(tipo === 'pago' ? '✅ Pago actualizado correctamente.' : '✅ Gasto actualizado correctamente.');
    cerrarEditarPagoGasto();
  }catch(err){
    console.error(err);
    alert('❌ Ocurrió un error al guardar: ' + err.message);
  }finally{
    btn.disabled = false; btn.textContent = '✅ Guardar Cambios';
  }
}

async function eliminarPagoDash(id){
  const p = _pagosRaw.find(x => x._id === id);
  if(!confirm(`¿Eliminar el pago de "${p?.cliente||'este cliente'}" ($${(parseFloat(p?.monto)||0).toFixed(2)})? Esta acción no se puede deshacer.`)) return;
  try{
    await db.collection('pagos').doc(id).delete();
    mostrarToastEdicion('🗑 Pago eliminado correctamente.');
  }catch(err){ console.error(err); alert('❌ No se pudo eliminar el pago: ' + err.message); }
}

async function eliminarGastoDash(id){
  const g = _gastosRaw.find(x => x._id === id);
  if(!confirm(`¿Eliminar el gasto "${g?.desc||g?.categoria||'este gasto'}" ($${(parseFloat(g?.monto)||0).toFixed(2)})? Esta acción no se puede deshacer.`)) return;
  try{
    await db.collection('gastos').doc(id).delete();
    mostrarToastEdicion('🗑 Gasto eliminado correctamente.');
  }catch(err){ console.error(err); alert('❌ No se pudo eliminar el gasto: ' + err.message); }
}

/* ════════════════════════════════════════════════════════════
   [NEW] PEDIDOS WEB — cola de pedidos de la página pública (colección
   aislada `pedidosWeb`, con create público abierto). El admin revisa
   cada uno y lo Aprueba (creando el pedido real, con asesor y forma de
   pago asignados) o lo Rechaza — nunca entran solos al sistema real.
════════════════════════════════════════════════════════════ */
let _unsubPedidosWeb = null, _pedidosWebRaw = [];
function _iniciarListenerPedidosWeb(){
  if(_unsubPedidosWeb){_unsubPedidosWeb();_unsubPedidosWeb=null;}
  _unsubPedidosWeb = db.collection('pedidosWeb').onSnapshot(snap => {
    _pedidosWebRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .filter(p => !p.estado || p.estado === 'pendiente') // [NEW] trata como pendiente cualquier doc sin campo 'estado' — la web pública podría no enviarlo
      .sort((a,b) => (a.creadoEn?.toMillis?.()||0) - (b.creadoEn?.toMillis?.()||0)); // más antiguo primero, como cola de trabajo
    renderPedidosWeb();
  }, err => console.error('listener pedidosWeb:', err));
}
function detenerListenerPedidosWeb(){ if(_unsubPedidosWeb){_unsubPedidosWeb();_unsubPedidosWeb=null;} }

function renderPedidosWeb(){
  const cont = document.getElementById('listaPedidosWeb');
  const count = document.getElementById('pedidosWebCount');
  if(!cont) return;
  if(count) count.textContent = _pedidosWebRaw.length + ' pendiente' + (_pedidosWebRaw.length!==1?'s':'');
  if(!_pedidosWebRaw.length){
    cont.innerHTML = '<div class="empty-state"><div class="icon">🌐</div>No hay pedidos web pendientes de aprobación</div>';
    return;
  }
  const optionsAsesor = _asesoresCache.map(r => `<option value="${escapeAttr(r)}">${r.split(':')[1]?.trim()||r}</option>`).join('');
  cont.innerHTML = _pedidosWebRaw.map((p, idx) => {
    const productos = (p.productos||[]).map(pr => `<tr><td>${escHTML(pr.nombre||'-')}</td><td style="text-align:center">${pr.cantidad||'-'}</td><td style="text-align:right">$${parseFloat(pr.precio||0).toFixed(2)}</td><td style="text-align:right">$${(parseFloat(pr.cantidad||0)*parseFloat(pr.precio||0)).toFixed(2)}</td></tr>`).join('');
    const totalWeb = (p.productos||[]).reduce((s,pr)=> s + (parseFloat(pr.cantidad||0)*parseFloat(pr.precio||0)), 0);
    return `
    <div class="cierre-cliente-block" style="margin:0 0 14px">
      <div class="cierre-cliente-header">
        <span class="cierre-cliente-nombre">🌐 ${escHTML(p.cliente||'Sin nombre')}</span>
        <span class="cierre-cliente-meta">📞 ${escHTML(p.telefono||'-')} · 📍 ${escHTML(p.direccion||'-')}</span>
        <span class="cierre-cliente-total">$${totalWeb.toFixed(2)}</span>
      </div>
      <table class="cierre-cliente-table">
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>${productos || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sin productos</td></tr>'}</tbody>
      </table>
      ${p.notas ? `<div style="padding:8px 14px;font-size:12px;color:var(--muted);border-top:1px solid var(--border)">📝 ${escHTML(p.notas)}</div>` : ''}
      <div style="padding:12px 14px;border-top:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="editar-field" style="margin-bottom:0;min-width:180px"><label>Asesor / Ruta</label><select id="pwAsesor-${idx}"><option value="">-- Selecciona --</option>${optionsAsesor}</select></div>
        <div class="editar-field" style="margin-bottom:0;min-width:150px"><label>Forma de Pago</label><select id="pwForma-${idx}"><option value="">-- Selecciona --</option><option value="Contado">Contado</option><option value="Crédito">Crédito</option><option value="Transferencia">Transferencia</option><option value="Cheque">Cheque</option></select></div>
        <button class="btn-guardar-edicion" style="padding:9px 16px" onclick="aprobarPedidoWeb('${p._id}', ${idx})">✅ Aprobar</button>
        <button class="btn-eliminar-fila" style="padding:9px 16px" onclick="rechazarPedidoWeb('${p._id}')">❌ Rechazar</button>
      </div>
    </div>`;
  }).join('');
}

async function aprobarPedidoWeb(id, idx){
  const p = _pedidosWebRaw.find(x => x._id === id);
  if(!p){ alert('Este pedido web ya no existe.'); return; }
  const asesor = document.getElementById(`pwAsesor-${idx}`).value;
  const formapago = document.getElementById(`pwForma-${idx}`).value;
  if(!asesor){ alert('Selecciona a qué asesor/ruta se le asigna este pedido.'); return; }
  if(!formapago){ alert('Selecciona la forma de pago.'); return; }
  const productos = (p.productos||[]).map(pr => ({ nombre: pr.nombre||'', cantidad: parseFloat(pr.cantidad)||0, precio: parseFloat(pr.precio)||0, subtotal: +((parseFloat(pr.cantidad)||0)*(parseFloat(pr.precio)||0)).toFixed(2), regalias: [] }));
  if(!productos.length){ alert('Este pedido no tiene productos válidos.'); return; }
  const total = +productos.reduce((s,pr)=>s+pr.subtotal,0).toFixed(2);
  try{
    await db.collection('pedidos').add({
      empleado: asesor, cliente: p.cliente||'Sin nombre', telefono: p.telefono||'', direccion: p.direccion||'',
      fecha: fechaHoy(), notas: (p.notas||'') + ' [Pedido recibido desde la página web]',
      formapago, total, productos, gps: null, origenWeb: true,
      creadoPor: ADMIN_ACTUAL.uid || null, creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('pedidosWeb').doc(id).update({ estado: 'aprobado', aprobadoPor: ADMIN_ACTUAL.nombre||'admin', aprobadoEn: firebase.firestore.FieldValue.serverTimestamp() });
    mostrarToastEdicion('✅ Pedido web aprobado — ya forma parte de las ventas reales.');
  }catch(err){ console.error(err); alert('❌ No se pudo aprobar el pedido: ' + err.message); }
}

async function rechazarPedidoWeb(id){
  if(!confirm('¿Rechazar este pedido web? No se creará ninguna venta real a partir de él.')) return;
  try{
    await db.collection('pedidosWeb').doc(id).update({ estado: 'rechazado', rechazadoPor: ADMIN_ACTUAL.nombre||'admin', rechazadoEn: firebase.firestore.FieldValue.serverTimestamp() });
    mostrarToastEdicion('❌ Pedido web rechazado.');
  }catch(err){ console.error(err); alert('❌ No se pudo rechazar el pedido: ' + err.message); }
}

/* ════════════════════════════════════════════════════════════
   [NEW] CREAR USUARIOS — Secretaria (solo Admin), ahora como pestaña
   del menú lateral en vez de modal — acceso de solo lectura al Dashboard.
════════════════════════════════════════════════════════════ */
async function poblarSelectEliminarSecretaria(){
  const sel = document.getElementById('sec-eliminar-select');
  sel.innerHTML = '<option value="">-- Selecciona --</option>';
  try{
    const snap = await db.collection('usuarios').where('esSecretaria','==',true).get();
    snap.forEach(doc => {
      const d = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = `${d.nombre||'Secretaria'} (${d.usuario||'-'})`;
      sel.appendChild(opt);
    });
  }catch(e){ console.error(e); }
}
async function crearSecretariaReal(){
  const nombre = document.getElementById('sec-nombre').value.trim();
  const usuario = document.getElementById('sec-usuario').value.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  const pass = document.getElementById('sec-pass').value;
  if(!nombre){ alert('Ingresa el nombre completo.'); return; }
  if(!usuario){ alert('Ingresa un usuario válido (solo letras y números, sin espacios).'); return; }
  if(!pass || pass.length<6){ alert('Firebase exige contraseñas de al menos 6 caracteres.'); return; }
  const email = _emailDeUsuario(usuario);
  const btn = document.getElementById('sec-btn-crear');
  btn.disabled = true; btn.textContent = 'Creando...';
  try{
    const cred = await _secondaryAuthDash.createUserWithEmailAndPassword(email, pass);
    const uid = cred.user.uid;
    await _secondaryAuthDash.signOut(); // limpia la instancia secundaria, no toca la sesión del admin
    await db.collection('usuarios').doc(uid).set({
      usuario, nombre, esAdmin: false, esSecretaria: true, rol: 'SECRETARIA',
      creadoPor: ADMIN_ACTUAL.uid || null, creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('sec-resultado').innerHTML = `✓ Cuenta creada — usuario: <b>${usuario}</b>. Ya puede iniciar sesión en este mismo Dashboard con acceso de solo lectura.`;
    document.getElementById('sec-resultado').style.display = 'block';
    document.getElementById('sec-nombre').value = '';
    document.getElementById('sec-usuario').value = '';
    document.getElementById('sec-pass').value = '';
    poblarSelectEliminarSecretaria();
  }catch(err){
    console.error(err);
    let msg = 'No se pudo crear la cuenta.';
    if(err.code === 'auth/email-already-in-use') msg = 'Ese usuario ya existe.';
    else if(err.code === 'auth/weak-password') msg = 'La contraseña es muy débil (mínimo 6 caracteres).';
    alert(msg);
  }finally{
    btn.disabled = false; btn.textContent = '✅ Crear Secretaria';
  }
}
async function eliminarSecretariaSeleccionada(){
  const uid = document.getElementById('sec-eliminar-select').value;
  if(!uid){ alert('Selecciona una cuenta de la lista.'); return; }
  if(!confirm('¿Quitar el acceso de esta Secretaria? Ya no podrá iniciar sesión.')) return;
  try{
    await db.collection('usuarios').doc(uid).delete();
    mostrarToastEdicion('✓ Acceso de Secretaria revocado.');
    poblarSelectEliminarSecretaria();
  }catch(err){ console.error(err); alert('No se pudo eliminar. Revisa la consola del navegador.'); }
}
