// netlify/functions/save-data.js
// Guarda datos en GitHub. Maneja 409 con reintentos automáticos.
// Tipos: ventas, cat, oc, ts (timestamp de última actualización)

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { tipo, data, filename } = JSON.parse(event.body);

    if (!tipo || data === undefined) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan parámetros: tipo, data' }) };
    }

    const GH_TOKEN  = process.env.GITHUB_TOKEN;
    const GH_REPO   = process.env.GITHUB_REPO;
    const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';

    if (!GH_TOKEN || !GH_REPO) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Faltan variables: GITHUB_TOKEN / GITHUB_REPO' }) };
    }

    const fileMap = {
      ventas: 'data/ventas.json',
      cat:    'data/cat.json',
      oc:     'data/oc.json',
      ts:     'data/ts.json'   // timestamp de última actualización
    };

    const path = fileMap[tipo];
    if (!path) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Tipo inválido. Usa: ventas, cat, oc, ts' }) };
    }

    const jsonStr    = JSON.stringify(data);
    const contentB64 = Buffer.from(jsonStr, 'utf-8').toString('base64');
    const apiBase    = `https://api.github.com/repos/${GH_REPO}/contents/${path}`;
    const headers    = {
      'Authorization': `token ${GH_TOKEN}`,
      'Accept':        'application/vnd.github.v3+json',
      'Content-Type':  'application/json',
      'User-Agent':    'dashboard-tac-sync'
    };

    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Obtener SHA fresco en cada intento
      let sha = null;
      const getResp = await fetch(`${apiBase}?ref=${GH_BRANCH}&t=${Date.now()}`, { headers });
      if (getResp.ok) {
        const getJson = await getResp.json();
        sha = getJson.sha || null;
      }

      const body = {
        message: `Update ${tipo} - ${new Date().toISOString().slice(0,16).replace('T',' ')} - ${filename||'dashboard'}`,
        content: contentB64,
        branch:  GH_BRANCH
      };
      if (sha) body.sha = sha;

      const putResp = await fetch(apiBase, {
        method:  'PUT',
        headers,
        body:    JSON.stringify(body)
      });

      if (putResp.ok) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true, tipo, path,
            rows: Array.isArray(data) ? data.length : null,
            attempt
          })
        };
      }

      const errJson = await putResp.json().catch(() => ({}));
      lastError = errJson.message || `HTTP ${putResp.status}`;

      if (putResp.status !== 409) {
        return { statusCode: putResp.status, body: JSON.stringify({ error: lastError }) };
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 400 * attempt));
      }
    }

    return { statusCode: 409, body: JSON.stringify({ error: `Conflicto tras ${MAX_RETRIES} intentos: ${lastError}` }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
