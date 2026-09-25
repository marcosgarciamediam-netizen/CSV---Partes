require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.static(__dirname));
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
    console.log('🔑 Contraseña y rol de admin@csv.com actualizados correctamente.');
  } else {
    await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, categoria, codigo_operario, activo) 
       VALUES ('Administrador', 'admin@csv.com', $1, 'admin', 'Gerencia', '0001', true)`,
      [hashReal]
    );
    console.log('👤 Usuario admin@csv.com creado con éxito con rol admin y contraseña 1234.');
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
      SET horas = $1, tareas = $2, id_obra = $3, fecha = $4
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

// ==========================================
// ENCENDIDO DEL SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend escuchando en el puerto ${PORT}`);
});

async function guardarEdicionParteModal() {
            const idParte = document.getElementById('modalIdParte').value;
            const horas = parseFloat(document.getElementById('modalHoras').value);
            const tareas = document.getElementById('modalTareas').value;
            let id_obra = document.getElementById('modalIdObraSeleccionada').value;

            // Si el ID de obra está vacío, buscamos por texto exacto
            if (!id_obra) {
                const textoEscrito = document.getElementById('buscadorObraInput').value.trim();
                const obraEncontrada = listaObrasGlobalAdmin.find(o => o.nombre.toLowerCase().trim() === textoEscrito.toLowerCase());
                if (obraEncontrada) {
                    id_obra = obraEncontrada.id_obra;
                }
            }

            if (isNaN(horas) || !id_obra) {
                alert('❌ Revisa que las horas sean correctas y hayas seleccionado una obra válida de la lista.');
                return;
            }

            // Enviamos exactamente las propiedades que el servidor procesa para el parte
            const payload = { 
                horas: horas, 
                tareas: tareas, 
                id_obra: parseInt(id_obra) 
            };

            try {
                const respuesta = await fetch(`/api/partes/${idParte}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const resultado = await respuesta.json();

                if (resultado.success) {
                    alert('✅ ¡Parte modificado correctamente!');
                    cerrarModalEdicion();
                    await buscarPartesFiltrados();
                } else {
                    alert('❌ Error del servidor: ' + (resultado.error || 'No se pudo modificar el parte.'));
                }
            } catch (error) {
                console.error('Error de red al editar el parte:', error);
                alert('❌ No se pudo conectar con el servidor.');
            }
        }


        
// ==========================================
// RUTA: Exportar Quincena con estilos de colores para Excel (.xls)
// ==========================================
app.get('/api/admin/exportar', async (req, res) => {
  const { inicio, fin } = req.query;

  try {
    let query = `
      SELECT 
        u.codigo_operario AS codigo,
        u.nombre AS trabajador,
        u.categoria AS categoria,
        o.nombre AS obra,
        TO_CHAR(pt.fecha, 'DD/MM/YYYY') AS fecha,
        pt.horas,
        pt.tareas,
        COALESCE(pt.tipo, 'trabajo') AS tipo
      FROM partes_trabajo pt
      JOIN usuarios u ON pt.id_usuario = u.id_usuario
      JOIN obras o ON pt.id_obra = o.id_obra
    `;

    const params = [];
    if (inicio && fin) {
      query += ` WHERE pt.fecha BETWEEN $1 AND $2`;
      params.push(inicio, fin);
    }

    query += ` ORDER BY pt.fecha ASC, u.nombre ASC;`;
    const resultado = await pool.query(query, params);

    let html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/1999/xlink">
      <head><meta charset="UTF-8"></head>
      <body>
      <table border="1">
        <tr style="background-color: #004b87; color: white; font-weight: bold;">
          <th>Código</th>
          <th>Trabajador</th>
          <th>Categoría</th>
          <th>Obra</th>
          <th>Fecha</th>
          <th>Horas / Valor</th>
          <th>Detalle / Tareas</th>
        </tr>
    `;

    resultado.rows.forEach(row => {
      let bgColor = "transparent";
      let valorCelda = row.horas;

      if (row.tipo === 'vacaciones') {
        bgColor = "#ffc0cb"; // Rosa
        valorCelda = "8";
      } else if (row.tipo === 'baja') {
        bgColor = "#90ee90"; // Verde
        valorCelda = "8";
      } else if (row.tipo === 'permiso') {
        bgColor = "#add8e6"; // Azul
      } else if (row.tipo === 'paternidad') {
        bgColor = "#e6e6fa"; // Lavanda / Neutro
        valorCelda = "P";
      }

      html += `
        <tr>
          <td>${row.codigo || ''}</td>
          <td>${row.trabajador}</td>
          <td>${row.categoria || ''}</td>
          <td>${row.obra}</td>
          <td>${row.fecha}</td>
          <td style="background-color: ${bgColor}; text-align: center; font-weight: bold;">${valorCelda}</td>
          <td>${row.tareas}</td>
        </tr>
      `;
    });

    html += `</table></body></html>`;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=quincena_informe.xls');
    res.status(200).send(html);

  } catch (error) {
    console.error('Error al exportar quincena:', error);
    res.status(500).json({ success: false, error: 'Error interno en el servidor' });
  }
});