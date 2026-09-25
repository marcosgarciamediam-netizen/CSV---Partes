require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'layoutcsv')));
app.use(express.json());

// Configuración unificada de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_omC28xqezMVi@ep-silent-boat-zah0a480-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
});

const PORT = process.env.PORT || 3000;

// ==========================================
// BLOQUE TEMPORAL: Forzar creación/actualización de admin@csv.com (Clave: 1234)
// ==========================================
pool.query('SELECT * FROM usuarios WHERE email = $1', ['admin@csv.com']).then(async (res) => {
  const hashReal = await bcrypt.hash('1234', 10);
  if (res.rows.length > 0) {
    await pool.query('UPDATE usuarios SET password_hash = $1, rol = $2 WHERE email = $3', [hashReal, 'admin', 'admin@csv.com']);
  } else {
    await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, categoria, codigo_operario, activo) 
       VALUES ('Administrador', 'admin@csv.com', $1, 'admin', 'Gerencia', '0001', true)`,
      [hashReal]
    );
  }
}).catch(err => console.error('Error al actualizar password automáticamente:', err));

// ==========================================
// RUTA PRINCIPAL: Carga el login desde layoutcsv
// ==========================================
app.get('/', (req, res) => {
  const rutaLayouts = path.join(__dirname, 'layoutcsv', 'index.html');
  const rutaRaiz = path.join(__dirname, 'index.html');

  if (fs.existsSync(rutaLayouts)) {
    res.sendFile(rutaLayouts);
  } else if (fs.existsSync(rutaRaiz)) {
    res.sendFile(rutaRaiz);
  } else {
    res.status(404).send('⚠️ No se encuentra el archivo index.html dentro de "layoutcsv".');
  }
});

// ==========================================
// RUTA: Inicio de Sesión (Login)
// ==========================================
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND activo = true;', [email]);
    
    if (resultado.rows.length === 0) {
      return res.json({ success: false, error: 'Usuario no encontrado o inactivo' });
    }

    const usuario = resultado.rows[0];
    const passwordMatch = await bcrypt.compare(password, usuario.password_hash);

    if (!passwordMatch) {
      return res.json({ success: false, error: 'Contraseña incorrecta' });
    }

    res.json({
      success: true,
      mensaje: `Bienvenido, ${usuario.nombre}`,
      rol: usuario.rol, 
      nombre: usuario.nombre,
      id_usuario: usuario.id_usuario,
      usuario: {
        id: usuario.id_usuario,
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        categoria: usuario.categoria
      }
    });

  } catch (error) {
    console.error('Error en el login:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// RUTA: Registrar un nuevo parte de trabajo
// ==========================================
app.post('/api/partes', async (req, res) => {
  const { id_usuario, id_obra, fecha, horas, tareas } = req.body;

  try {
    const query = `
      INSERT INTO partes_trabajo (id_usuario, id_obra, fecha, horas, tareas, creado_por, tipo)
      VALUES ($1, $2, $3, $4, $5, $1, 'trabajo')
      RETURNING *;
    `;
    const values = [id_usuario, id_obra, fecha, horas, tareas];
    const nuevoParte = await pool.query(query, values);

    res.status(201).json({
      success: true,
      mensaje: '¡Parte registrado con éxito en la base de datos!',
      parte: nuevoParte.rows[0]
    });
  } catch (error) {
    console.error('Error al guardar el parte:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// RUTA: Modificar un parte de trabajo existente
// ==========================================
app.put('/api/partes/:id_parte', async (req, res) => {
  const { id_parte } = req.params;
  const { horas, tareas, id_obra, fecha } = req.body;

  try {
    const query = `
      UPDATE partes_trabajo 
      SET horas = $1, tareas = $2, id_obra = $3, fecha = COALESCE($4, fecha)
      WHERE id_parte = $5
      RETURNING *;
    `;
    const resultado = await pool.query(query, [horas, tareas, id_obra, fecha, id_parte]);

    if (resultado.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Parte no encontrado' });
    }

    res.json({ success: true, mensaje: '¡Parte modificado correctamente!', parte: resultado.rows[0] });
  } catch (error) {
    console.error('Error al modificar el parte:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// RUTA: Consultar partes filtrados (Operario, Obra y Rango de Fechas)
// ==========================================
app.get('/api/admin/partes-filtrados', async (req, res) => {
  const { id_usuario, id_obra, fecha_inicio, fecha_fin } = req.query;

  try {
    let query = `
      SELECT pt.id_parte, pt.fecha, pt.horas, pt.tareas, 
             TO_CHAR(pt.fecha, 'DD/MM/YYYY') AS fecha_registro,
             u.nombre AS operario_nombre, u.codigo_operario, u.categoria,
             o.id_obra, o.nombre AS obra_nombre, COALESCE(pt.tipo, 'trabajo') AS tipo
      FROM partes_trabajo pt
      JOIN usuarios u ON pt.id_usuario = u.id_usuario
      JOIN obras o ON pt.id_obra = o.id_obra
      WHERE 1=1
    `;
    const params = [];
    let index = 1;

    if (id_usuario && id_usuario !== '' && id_usuario !== 'undefined' && id_usuario !== 'null') {
      query += ` AND pt.id_usuario = $${index++}`; params.push(id_usuario);
    }
    if (id_obra && id_obra !== '' && id_obra !== 'undefined' && id_obra !== 'null') {
      query += ` AND pt.id_obra = $${index++}`; params.push(id_obra);
    }
    if (fecha_inicio && fecha_fin) {
      query += ` AND pt.fecha BETWEEN $${index++} AND $${index++}`; params.push(fecha_inicio, fecha_fin);
    } else if (fecha_inicio) {
      query += ` AND pt.fecha >= $${index++}`; params.push(fecha_inicio);
    } else if (fecha_fin) {
      query += ` AND pt.fecha <= $${index++}`; params.push(fecha_fin);
    }

    query += ` ORDER BY pt.fecha DESC, u.nombre ASC;`;
    const resultado = await pool.query(query, params);

    res.json({ success: true, partes: resultado.rows });
  } catch (error) {
    console.error('Error al filtrar partes:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// RUTA: Obtener operarios asignados a un Encargado
// ==========================================
app.get('/api/encargado/:id_encargado/plantilla', async (req, res) => {
  const { id_encargado } = req.params;

  try {
    const query = `
      SELECT u.id_usuario, u.codigo_operario, u.nombre, u.categoria
      FROM asignacion_plantilla ap
      JOIN usuarios u ON ap.id_operario = u.id_usuario
      WHERE ap.id_encargado = $1;
    `;
    const resultado = await pool.query(query, [id_encargado]);

    res.json({ success: true, plantilla: resultado.rows });
  } catch (error) {
    console.error('Error al obtener la plantilla del encargado:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// RUTA: Consultar partes de la cuadrilla del Encargado
// ==========================================
app.get('/api/encargado/:id_encargado/partes', async (req, res) => {
  const { id_encargado } = req.params;

  try {
    const query = `
      SELECT pt.id_parte, pt.fecha, pt.horas, pt.tareas, pt.id_obra,
             u.nombre AS operario_nombre, 
             o.nombre AS obra_nombre
      FROM partes_trabajo pt
      JOIN asignacion_plantilla ap ON pt.id_usuario = ap.id_operario
      JOIN usuarios u ON pt.id_usuario = u.id_usuario
      JOIN obras o ON pt.id_obra = o.id_obra
      WHERE ap.id_encargado = $1
      ORDER BY pt.fecha DESC, pt.id_parte DESC
      LIMIT 15;
    `;
    const resultado = await pool.query(query, [id_encargado]);

    res.json({ success: true, partes: resultado.rows });
  } catch (error) {
    console.error('Error al obtener partes de la cuadrilla:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// RUTA: Obtener alertas de operarios sin parte hoy
// ==========================================
app.get('/api/admin/alertas', async (req, res) => {
  try {
    const query = `
      SELECT u.id_usuario, u.codigo_operario, u.nombre, u.email 
      FROM usuarios u 
      WHERE u.rol = 'operario' 
      AND u.id_usuario NOT IN (
        SELECT DISTINCT id_usuario 
        FROM partes_trabajo 
        WHERE fecha = CURRENT_DATE
      );
    `;
    const resultado = await pool.query(query);

    res.json({ success: true, alertas: resultado.rows });
  } catch (error) {
    console.error('Error al obtener alertas de admin:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// GESTIÓN DE OBRAS
// ==========================================
app.get('/api/obras', async (req, res) => {
  try {
    const query = 'SELECT id_obra, nombre FROM obras ORDER BY nombre ASC;';
    const resultado = await pool.query(query);
    res.json({ success: true, obras: resultado.rows });
  } catch (error) {
    console.error('Error al obtener las obras:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.get('/api/admin/obras-todas', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM obras ORDER BY nombre ASC;');
    res.json({ success: true, obras: resultado.rows });
  } catch (error) {
    console.error('Error al obtener todas las obras:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.post('/api/admin/obras', async (req, res) => {
  const { nombre } = req.body;
  try {
    const resultado = await pool.query(
      'INSERT INTO obras (nombre, activo) VALUES ($1, true) RETURNING *;',
      [nombre]
    );
    res.json({ success: true, obra: resultado.rows[0] });
  } catch (error) {
    console.error('Error al crear obra:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.put('/api/admin/obras/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    await pool.query('UPDATE obras SET activo = $1 WHERE id_obra = $2;', [activo, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error al cambiar estado de obra:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// GESTIÓN DE USUARIOS
// ==========================================
app.get('/api/admin/operarios', async (req, res) => {
  try {
    const query = `SELECT id_usuario, nombre FROM usuarios WHERE rol = 'operario' ORDER BY nombre ASC;`;
    const resultado = await pool.query(query);
    res.json({ success: true, operarios: resultado.rows });
  } catch (error) {
    console.error('Error al obtener operarios:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.get('/api/admin/usuarios-todos', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id_usuario, codigo_operario, nombre, email, rol, categoria, activo FROM usuarios ORDER BY nombre ASC;');
    res.json({ success: true, usuarios: resultado.rows });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.post('/api/admin/usuarios', async (req, res) => {
  const { nombre, email, password, rol, categoria, codigo_operario } = req.body;
  try {
    const passwordHash = await bcrypt.hash(password || '123456', 10);
    const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, categoria, codigo_operario, activo) 
       VALUES ($1, $2, $3, $4, $5, $6, true) 
       RETURNING id_usuario, nombre, email, rol, categoria, codigo_operario;`,
      [nombre, email, passwordHash, rol || 'operario', categoria || 'General', codigo_operario || Math.floor(1000 + Math.random() * 9000)]
    );
    res.json({ success: true, usuario: resultado.rows[0] });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.put('/api/admin/usuarios/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    await pool.query('UPDATE usuarios SET activo = $1 WHERE id_usuario = $2;', [activo, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error al cambiar estado de usuario:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.put('/api/admin/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, email, rol, categoria, codigo_operario } = req.body;
  try {
    await pool.query(
      `UPDATE usuarios 
       SET nombre = $1, email = $2, rol = $3, categoria = $4, codigo_operario = $5 
       WHERE id_usuario = $6;`,
      [nombre, email, rol, categoria, codigo_operario, id]
    );
    res.json({ success: true, mensaje: '¡Usuario actualizado con éxito!' });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.put('/api/admin/usuarios/:id/password', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  try {
    const passwordHash = await bcrypt.hash(password || '123456', 10);
    await pool.query(
      `UPDATE usuarios SET password_hash = $1 WHERE id_usuario = $2;`,
      [passwordHash, id]
    );
    res.json({ success: true, mensaje: '¡Contraseña restablecida con éxito!' });
  } catch (error) {
    console.error('Error al restablecer contraseña:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// RUTA: Asignar estado especial
// ==========================================
app.post('/api/admin/estado-especial', async (req, res) => {
  const { id_usuario, fecha, tipo, horas, tareas, id_obra } = req.body;

  try {
    const query = `
      INSERT INTO partes_trabajo (id_usuario, id_obra, fecha, horas, tareas, tipo, creado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $1)
      RETURNING *;
    `;
    const obraId = id_obra || 1;
    const resultado = await pool.query(query, [id_usuario, obraId, fecha, horas, tareas, tipo]);

    res.json({ success: true, mensaje: '¡Estado asignado correctamente!', parte: resultado.rows[0] });
  } catch (error) {
    console.error('Error al asignar estado especial:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// ASIGNACIÓN DE PLANTILLA
// ==========================================
app.get('/api/admin/asignaciones-plantilla', async (req, res) => {
  try {
    const query = `
      SELECT ap.id_asignacion, e.id_usuario AS id_encargado, e.nombre AS encargado_nombre,
             op.id_usuario AS id_operario, op.nombre AS operario_nombre, op.codigo_operario
      FROM asignacion_plantilla ap
      JOIN usuarios e ON ap.id_encargado = e.id_usuario
      JOIN usuarios op ON ap.id_operario = op.id_usuario;
    `;
    const resultado = await pool.query(query);
    res.json({ success: true, asignaciones: resultado.rows });
  } catch (error) {
    console.error('Error al obtener asignaciones de plantilla:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.post('/api/admin/asignaciones-plantilla', async (req, res) => {
  const { id_encargado, id_operario } = req.body;
  try {
    const check = await pool.query('SELECT * FROM asignacion_plantilla WHERE id_encargado = $1 AND id_operario = $2', [id_encargado, id_operario]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Este operario ya está asignado a este encargado' });
    }
    await pool.query('INSERT INTO asignacion_plantilla (id_encargado, id_operario) VALUES ($1, $2)', [id_encargado, id_operario]);
    res.json({ success: true, mensaje: '¡Operario asignado con éxito!' });
  } catch (error) {
    console.error('Error al asignar operario:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.post('/api/admin/asignaciones-plantilla-multiples', async (req, res) => {
  const { id_encargado, ids_operarios } = req.body;

  if (!id_encargado || !ids_operarios || !Array.isArray(ids_operarios)) {
    return res.status(400).json({ success: false, error: 'Datos incompletos' });
  }

  try {
    for (const id_operario of ids_operarios) {
      const check = await pool.query(
        'SELECT * FROM asignacion_plantilla WHERE id_encargado = $1 AND id_operario = $2', 
        [id_encargado, id_operario]
      );
      if (check.rows.length === 0) {
        await pool.query(
          'INSERT INTO asignacion_plantilla (id_encargado, id_operario) VALUES ($1, $2)', 
          [id_encargado, id_operario]
        );
      }
    }

    res.json({ success: true, mensaje: '¡Asignación múltiple completada con éxito!' });
  } catch (error) {
    console.error('Error en asignación múltiple:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.delete('/api/admin/asignaciones-plantilla/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM asignacion_plantilla WHERE id_asignacion = $1', [id]);
    res.json({ success: true, mensaje: '¡Asignación eliminada!' });
  } catch (error) {
    console.error('Error al eliminar asignación:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// ASIGNACIÓN DE OBRAS
// ==========================================
app.get('/api/admin/asignaciones-obras', async (req, res) => {
  try {
    const query = `
      SELECT ao.id_asignacion, j.id_usuario AS id_jefe, j.nombre AS jefe_nombre,
             o.id_obra, o.nombre AS obra_nombre
      FROM asignacion_obras_jefe ao
      JOIN usuarios j ON ao.id_jefe = j.id_usuario
      JOIN obras o ON ao.id_obra = o.id_obra;
    `;
    const resultado = await pool.query(query);
    res.json({ success: true, asignaciones: resultado.rows });
  } catch (error) {
    console.error('Error al obtener asignaciones de obras:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.post('/api/admin/asignaciones-obras', async (req, res) => {
  const { id_jefe, id_obra } = req.body;
  try {
    const check = await pool.query('SELECT * FROM asignacion_obras_jefe WHERE id_jefe = $1 AND id_obra = $2', [id_jefe, id_obra]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Esta obra ya está asignada a este jefe' });
    }
    await pool.query('INSERT INTO asignacion_obras_jefe (id_jefe, id_obra) VALUES ($1, $2)', [id_jefe, id_obra]);
    res.json({ success: true, mensaje: '¡Obra asignada con éxito!' });
  } catch (error) {
    console.error('Error al asignar obra:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.delete('/api/admin/asignaciones-obras/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM asignacion_obras_jefe WHERE id_asignacion = $1', [id]);
    res.json({ success: true, mensaje: '¡Asignación eliminada!' });
  } catch (error) {
    console.error('Error al eliminar asignación de obra:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

app.get('/api/jefe/:id_jefe/obras', async (req, res) => {
  const { id_jefe } = req.params;
  try {
    const query = `
      SELECT o.id_obra, o.nombre 
      FROM asignacion_obras_jefe ao
      JOIN obras o ON ao.id_obra = o.id_obra
      WHERE ao.id_jefe = $1 ORDER BY o.nombre ASC;
    `;
    const resultado = await pool.query(query, [id_jefe]);
    res.json({ success: true, obras: resultado.rows });
  } catch (error) {
    console.error('Error al obtener obras del jefe:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

const ExcelJS = require('exceljs');

// ==========================================
// RUTA: Exportar Quincena en Formato Matricial Excel Real (.xlsx) con Formato Numérico
// ==========================================
app.get('/api/admin/exportar', async (req, res) => {
  const { inicio, fin } = req.query;

  if (!inicio || !fin) {
    return res.status(400).send('Faltan fechas de inicio y fin.');
  }

  try {
    const dIni = new Date(inicio);
    const dFin = new Date(fin);
    const diasArray = [];
    let curr = new Date(dIni);
    while (curr <= dFin) {
      diasArray.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
    }

    const query = `
      SELECT pt.id_usuario, u.codigo_operario, u.nombre AS operario_nombre, u.categoria,
             pt.id_obra, o.nombre AS obra_nombre, pt.fecha, pt.horas, COALESCE(pt.tipo, 'trabajo') AS tipo
      FROM partes_trabajo pt
      JOIN usuarios u ON pt.id_usuario = u.id_usuario
      JOIN obras o ON pt.id_obra = o.id_obra
      WHERE pt.fecha BETWEEN $1 AND $2
      ORDER BY o.nombre ASC, u.nombre ASC, pt.fecha ASC;
    `;
    const resultado = await pool.query(query, [inicio, fin]);
    const partes = resultado.rows;

    const obrasMap = {};
    partes.forEach(p => {
      if (!obrasMap[p.id_obra]) {
        obrasMap[p.id_obra] = { nombre: p.obra_nombre, operarios: {} };
      }
      const obraObj = obrasMap[p.id_obra];
      if (!obraObj.operarios[p.id_usuario]) {
        obraObj.operarios[p.id_usuario] = {
          codigo: p.codigo_operario || '',
          nombre: p.operario_nombre,
          categoria: p.categoria || '',
          obraNombre: p.obra_nombre,
          dias: {},
          totalHoras: 0
        };
      }
      const opObj = obraObj.operarios[p.id_usuario];
      const fechaStr = new Date(p.fecha).toISOString().split('T')[0];
      
      let val = p.horas;
      let tipo = p.tipo;
      if (tipo === 'vacaciones') val = 'V';
      else if (tipo === 'baja') val = 'B';
      else if (tipo === 'paternidad') val = 'P';
      
      opObj.dias[fechaStr] = { val, tipo };
    });

    const letrasDiasMap = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Informe Quincenal');

    const estiloBordeFino = {
      top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
    };

    const estilosFondo = {
      rojo: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } },
      vacaciones: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC0CB' } },
      baja: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF90EE90' } },
      permiso: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFADD8E6' } },
      cabecera: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } },
      obraCab: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EDF7' } }
    };

    Object.values(obrasMap).forEach(obra => {
      let totalHorasObra = 0;

      // 1. Cabecera de letras
      const filaLetras = ['Código', 'Operario', 'Categoría', 'Obra'];
      diasArray.forEach(d => filaLetras.push(letrasDiasMap[d.getDay()]));
      filaLetras.push('Total Horas');

      const rLetras = sheet.addRow(filaLetras);
      rLetras.font = { bold: true };
      rLetras.eachCell((cell) => {
        cell.fill = estilosFondo.cabecera;
        cell.border = estiloBordeFino;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      // 2. Cabecera de números de días (como valores numéricos reales)
      const filaNumeros = [obra.nombre, '', '', ''];
      diasArray.forEach(d => filaNumeros.push(d.getDate()));
      filaNumeros.push('');

      const rNum = sheet.addRow(filaNumeros);
      rNum.font = { bold: true, color: { argb: 'FF004B87' } };
      
      // Forzar celdas de números de días como tipo número
      diasArray.forEach((d, idx) => {
        const cell = rNum.getCell(5 + idx);
        cell.value = d.getDate();
        cell.numFmt = '0';
      });

      rNum.eachCell((cell) => {
        cell.fill = estilosFondo.obraCab;
        cell.border = estiloBordeFino;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      sheet.mergeCells(`A${rNum.number}:D${rNum.number}`);

      // 3. Filas de Operarios
      Object.values(obra.operarios).forEach(op => {
        const filaOp = [op.codigo, op.nombre, op.categoria, op.obraNombre];
        let sumaOp = 0;
        const tiposDiasArray = [];

        diasArray.forEach(d => {
          const fStr = d.toISOString().split('T')[0];
          const celdaData = op.dias[fStr];
          let contenido = null;
          let tipoCelda = 'trabajo';

          if (celdaData) {
            if (celdaData.tipo === 'vacaciones') { 
              contenido = 'V'; 
              tipoCelda = 'vacaciones'; 
            }
            else if (celdaData.tipo === 'baja') { 
              contenido = 'B'; 
              tipoCelda = 'baja'; 
            }
            else if (celdaData.tipo === 'paternidad') { 
              contenido = 'P'; 
              tipoCelda = 'permiso'; 
            }
            else if (celdaData.tipo === 'permiso') { 
              contenido = parseFloat(celdaData.val || 0); 
              tipoCelda = 'permiso'; 
              sumaOp += contenido; 
            }
            else { 
              contenido = parseFloat(celdaData.val || 0); 
              tipoCelda = 'trabajo'; 
              sumaOp += contenido; 
            }
          }
          filaOp.push(contenido);
          tiposDiasArray.push(tipoCelda);
        });

        filaOp.push(Math.round(sumaOp * 10) / 10);
        totalHorasObra += sumaOp;

        const rOp = sheet.addRow(filaOp);
        rOp.border = estiloBordeFino;
        rOp.alignment = { vertical: 'middle' };

        // Asegurar formato numérico en las horas y aplicar colores
        diasArray.forEach((d, idx) => {
          const colIndex = 5 + idx;
          const cell = rOp.getCell(colIndex);
          cell.alignment = { horizontal: 'center', vertical: 'middle' };

          // Si es un número (horas trabajadas o permiso numérico), asignar formato decimal de Excel
          if (typeof cell.value === 'number') {
            cell.numFmt = '#,##0.0';
          }

          const esFinDeSemana = d.getDay() === 0 || d.getDay() === 6;
          const tipo = tiposDiasArray[idx];

          if (tipo === 'vacaciones') {
            cell.fill = estilosFondo.vacaciones;
            cell.font = { bold: true, color: { argb: 'FF990033' } };
          } else if (tipo === 'baja') {
            cell.fill = estilosFondo.baja;
            cell.font = { bold: true, color: { argb: 'FF003300' } };
          } else if (tipo === 'permiso' && isNaN(cell.value)) {
            cell.fill = estilosFondo.permiso;
            cell.font = { bold: true, color: { argb: 'FF000066' } };
          } else if (tipo === 'permiso' && !isNaN(cell.value)) {
            cell.fill = estilosFondo.permiso;
            cell.font = { bold: true, color: { argb: 'FF000066' } };
          } else if (esFinDeSemana) {
            cell.fill = estilosFondo.rojo;
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          }
        });

        // Formato para la celda de Total Horas de la fila
        const cellTotalOp = rOp.getCell(rOp.cellCount);
        cellTotalOp.numFmt = '#,##0.0';
      });

      // 4. Fila Total Obra
      const filaTotal = [`Total ${obra.nombre}`];
      for(let i=0; i < diasArray.length + 3; i++) filaTotal.push('');
      filaTotal.push(Math.round(totalHorasObra * 10) / 10);

      const rTot = sheet.addRow(filaTotal);
      rTot.font = { bold: true, color: { argb: 'FF004B87' } };
      
      const cellValTot = rTot.getCell(rTot.cellCount);
      cellValTot.numFmt = '#,##0.0';

      rTot.eachCell((cell) => {
        cell.fill = estilosFondo.obraCab;
        cell.border = estiloBordeFino;
        cell.alignment = { vertical: 'middle' };
      });
      sheet.mergeCells(`A${rTot.number}:D${rTot.number}`);

      sheet.addRow([]);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=informe_quincenal_matricial.xlsx');

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error al exportar matriz quincenal con ExcelJS:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// ==========================================
// RUTA: Exportar Excel de Dedicación Mensual de Jefe de Obra (.xlsx)
// ==========================================
app.get('/api/admin/exportar-dedicacion-jefe/:id_jefe', async (req, res) => {
  const { id_jefe } = req.params;
  const { mes, anio } = req.query;

  const now = new Date();
  const targetAnio = anio ? parseInt(anio) : now.getFullYear();
  const targetMes = mes ? parseInt(mes) : now.getMonth() + 1; // 1-12

  const inicioMes = `${targetAnio}-${String(targetMes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(targetAnio, targetMes, 0).getDate();
  const finMes = `${targetAnio}-${String(targetMes).padStart(2, '0')}-${ultimoDia}`;

  try {
    // 1. Obtener nombre del jefe de obra
    const resJefe = await pool.query('SELECT nombre FROM usuarios WHERE id_usuario = $1', [id_jefe]);
    if (resJefe.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Jefe de obra no encontrado' });
    }
    const nombreJefe = resJefe.rows[0].nombre;

    // 2. Obtener las obras asignadas a este jefe de obra
    const resObrasJefe = await pool.query(`
      SELECT o.id_obra, o.nombre 
      FROM asignacion_obras_jefe ao
      JOIN obras o ON ao.id_obra = o.id_obra
      WHERE ao.id_jefe = $1
      ORDER BY o.nombre ASC;
    `, [id_jefe]);

    const obrasAsignadas = resObrasJefe.rows;

    if (obrasAsignadas.length === 0) {
      return res.status(400).send('Este jefe de obra no tiene obras asignadas actualmente.');
    }

    // 3. Consultar las horas registradas en esas obras durante el mes
    const resHoras = await pool.query(`
      SELECT pt.id_obra, SUM(pt.horas) AS total_horas
      FROM partes_trabajo pt
      WHERE pt.id_obra = ANY($1::int[])
        AND pt.fecha BETWEEN $2 AND $3
      GROUP BY pt.id_obra;
    `, [obrasAsignadas.map(o => o.id_obra), inicioMes, finMes]);

    const horasPorObra = {};
    let horasTotalesGlobal = 0;
    resHoras.rows.forEach(row => {
      const h = parseFloat(row.total_horas || 0);
      horasPorObra[row.id_obra] = h;
      horasTotalesGlobal += h;
    });

    // 4. Generar el Excel con ExcelJS
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Dedicación Mensual');

    const estiloBordeFino = {
      top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
    };

    // Título superior
    sheet.addRow([`DEDICACIÓN MENSUAL DE JEFES DE OBRA - ${nombreJefe.toUpperCase()}`]);
    sheet.mergeCells('A1:C1');
    const rTitulo = sheet.getRow(1);
    rTitulo.font = { bold: true, size: 12, color: { argb: 'FF004B87' } };
    rTitulo.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.addRow([]); // Fila vacía

    // Cabecera de la tabla
    const rCabecera = sheet.addRow(['Obra', 'Horas empleadas', 'Porcentaje']);
    rCabecera.font = { bold: true, color: { argb: 'FF000000' } };
    rCabecera.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      cell.border = estiloBordeFino;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Filas de Obras
    obrasAsignadas.forEach(obra => {
      const horasObra = horasPorObra[obra.id_obra] || 0;
      const porcentaje = horasTotalesGlobal > 0 ? (horasObra / horasTotalesGlobal) : 0;

      const fila = sheet.addRow([obra.nombre, horasObra, porcentaje]);
      
      // Formato celda Obra
      fila.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      fila.getCell(1).border = estiloBordeFino;

      // Formato celda Horas (Numérico real)
      const cellHoras = fila.getCell(2);
      cellHoras.value = horasObra;
      cellHoras.numFmt = '#,##0.0';
      cellHoras.alignment = { horizontal: 'right', vertical: 'middle' };
      cellHoras.border = estiloBordeFino;

      // Formato celda Porcentaje (Numérico real con formato porcentaje)
      const cellPorc = fila.getCell(3);
      cellPorc.value = porcentaje;
      cellPorc.numFmt = '0.0%';
      cellPorc.alignment = { horizontal: 'right', vertical: 'middle' };
      cellPorc.border = estiloBordeFino;
    });

    // Fila Total
    const filaTotal = sheet.addRow(['Total', horasTotalesGlobal, horasTotalesGlobal > 0 ? 1 : 0]);
    filaTotal.font = { bold: true, color: { argb: 'FF004B87' } };
    filaTotal.eachCell((cell, colNumber) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EDF7' } };
      cell.border = estiloBordeFino;
      if (colNumber === 1) cell.alignment = { horizontal: 'left', vertical: 'middle' };
      if (colNumber === 2) {
        cell.value = horasTotalesGlobal;
        cell.numFmt = '#,##0.0';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
      if (colNumber === 3) {
        cell.value = horasTotalesGlobal > 0 ? 1 : 0;
        cell.numFmt = '0.0%';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });

    // Ajustar anchos de columna
    sheet.columns = [
      { width: 45 }, // Obra
      { width: 22 }, // Horas
      { width: 22 }  // Porcentaje
    ];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=dedicacion_${nombreJefe.replace(/\s+/g, '_')}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error al exportar dedicación de jefe de obra:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});

// Endpoint para obtener el resumen de horas imputadas por los Jefes de Obra
app.get('/api/admin/resumen-jefes-dedicacion', async (req, res) => {
    const { inicio, fin } = req.query;
    if (!inicio || !fin) {
        return res.status(400).json({ success: false, error: 'Faltan las fechas de inicio y fin' });
    }

    try {
        const resultado = await pool.query(`
            SELECT id_usuario, SUM(horas) as total_horas
            FROM partes_trabajo
            WHERE fecha BETWEEN $1 AND $2
            GROUP BY id_usuario;
        `, [inicio, fin]);

        res.json({ success: true, resumen: resultado.rows });
    } catch (error) {
        console.error("Error SQL detallado en resumen-jefes:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


// ==========================================
// RUTA: Eliminar un parte de trabajo
// ==========================================
app.delete('/api/partes/:id_parte', async (req, res) => {
  const { id_parte } = req.params;

  try {
    const resultado = await pool.query('DELETE FROM partes_trabajo WHERE id_parte = $1 RETURNING *;', [id_parte]);

    if (resultado.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Parte no encontrado' });
    }

    res.json({ success: true, mensaje: '¡Parte eliminado correctamente!' });
  } catch (error) {
    console.error('Error al eliminar el parte:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});


// ==========================================
// ENCENDIDO DEL SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend escuchando en el puerto ${PORT}`);
});