// CommonJS wrapper for mounting Refraction in main-server.js

const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const staticPath = path.join(__dirname, 'dist');

if (fs.existsSync(staticPath)) {
  app.use(
    express.static(staticPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
      },
      redirect: false,
    }),
  );

  app.get('*', (req, res) => {
    const ext = path.extname(req.path);
    if (ext && ext !== '.html') {
      const filePath = path.join(staticPath, req.path);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      return res.status(404).send('Not found');
    }
    if (ext === '.html') {
      const filePath = path.join(staticPath, req.path);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      return res.status(404).send('Not found');
    }
    res.sendFile(path.join(staticPath, 'index.html'));
  });
} else {
  console.warn('⚠️  Refraction: dist/ not found. Run: npm run build');
  app.get('*', (req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send('Refraction is not built. Run npm run build in refraction.');
  });
}

module.exports = app;
