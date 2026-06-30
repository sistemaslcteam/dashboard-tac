// netlify/functions/save-data.js
//
// Función serverless que recibe datos (ventas, cat, oc) desde el dashboard
// y los guarda en GitHub usando un token GUARDADO COMO VARIABLE DE ENTORNO
// en Netlify (nunca expuesto al navegador).
//
// El usuario del dashboard NO necesita configurar nada — solo sube su archivo
// y esta función hace el resto de forma segura.

exports.handler = async function (event) {
  // Solo aceptar POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { tipo, data, filename } = JSON.parse(event.body);

    if (!tipo || !data) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan parámetros: tipo, data' }) };
    }

    // Estas variables se configuran en Netlify → Site settings → Environment variables
    // NUNCA se exponen al navegador del usuario.
    const GH_TOKEN  = process.env.GITHUB_TOKEN;
    const GH_REPO   = process.env.GITHUB_REPO;   // ej: "sistemaslcteam/dashboard-tac"
    const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';

    if (!GH_TOKEN || !GH_REPO) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Servidor no configurado. Faltan variables de entorno GITHUB_TOKEN / GITHUB_REPO en Netlify.'
        })
      };
    }

    const fileMap = {
      ventas: 'data/ventas.json',
      cat: 'data/cat.json',
      oc: 'data/oc.json'
    };
    const path = fileMap[tipo];
    if (!path) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Tipo inválido. Usa: ventas, cat, oc' }) };
    }

    // El contenido ya viene como JSON string desde el dashboard
    const jsonStr = JSON.stringify(data);
    const contentB64 = Buffer.from(jsonStr, 'utf-8').toString('base64');

    const apiBase = `https://api.github.com/repos/${GH_REPO}/contents/${path}`;
    const headers = {
      'Authorization': `token ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'dashboard-tac-sync'
    };

    // 1. Obtener el SHA actual del archivo (si existe) — requerido por GitHub para actualizar
    let sha = null;
    const getResp = await fetch(`${apiBase}?ref=${GH_BRANCH}`, { headers });
    if (getResp.ok) {
      const getJson = await getResp.json();
      sha = getJson.sha || null;
    }

    // 2. Subir / actualizar el archivo
    const body = {
      message: `Update ${tipo} - ${new Date().toISOString().slice(0, 10)} - ${filename || 'sin nombre'}`,
      content: contentB64,
      branch: GH_BRANCH
    };
    if (sha) body.sha = sha;

    const putResp = await fetch(apiBase, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });

    if (!putResp.ok) {
      const errJson = await putResp.json().catch(() => ({}));
      return {
        statusCode: putResp.status,
        body: JSON.stringify({ error: errJson.message || 'Error al subir a GitHub' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, tipo, path, rows: Array.isArray(data) ? data.length : null })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
